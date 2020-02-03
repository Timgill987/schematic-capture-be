const router = require("express").Router();
const jwt = require("jsonwebtoken");
const axios = require("axios");

const { firebase } = require("../../../utils");
const { Users } = require("../../../data/models");
const {
  FBauth,
  validateInvitation,
  validateGoogleSignIn,
  checkAccountExists
} = require("../../middleware");

router.get("/google/signin", checkAccountExists, (req, res) => {
  Users.findBy({ "users.id": req.query.uid })
    .first()
    .then(user => {
      res.status(200).json({ ...user, token: req.query.token });
    })
    .catch(error => res.status(500).json({ error: error.message }));
});

router.get("/google/create", (req, res) => {
  const newUser = {
    id: req.query.uid,
    email: req.query.email,
    first_name: req.query.firstName,
    last_name: req.query.lastName,
    phone: req.query.phone
  };

  return Users.add(newUser)
    .then(user => {
      return res.status(201).json({ ...user, token: req.query.idToken });
    })
    .catch(error => {
      // TODO add firebase cleanup on unsuccessful insert to the database.
      return res.status(500).json({ error: error.message });
    });
});

router.post(
  "/register",
  validateInvitation,
  validateGoogleSignIn,
  (req, res) => {
    const { email, password, first_name, last_name, phone } = req.body;

    // TODO write middleware to strip out unecessary content before passing to this route.
    let uid;

    firebase
      .auth()
      .createUserWithEmailAndPassword(email, password)
      .then(data => {
        newUser.id = data.user.uid;

        return data.user.getIdToken();
      })
      .then(token => {
        const newUser = {
          email,
          password,
          first_name,
          last_name,
          phone
        };
        Users.add(newUser)
          .then(user => {
            return res.status(201).json({ ...user, token });
          })
          .catch(error => {
            // TODO add firebase cleanup on unsuccessful insert to the database.
            return res.status(500).json({ error: error.message });
          });
      })
      .catch(error => res.status(500).json({ error: error.message }));
  }
);

router.post("/gauth", (req, res) => {});

router.post("/login", validateGoogleSignIn, async (req, res) => {
  const { email, password } = req.body;
  // TODO write middleware to validate requests to /register and /login

  // const { valid, errors } = validateLoginData(req.body);
  // if (!valid) return res.status(400).json(errors);

  let uid;

  firebase
    .auth()
    .signInWithEmailAndPassword(email, password)
    .then(data => {
      uid = data.user.uid;
      return data.user.getIdToken();
    })
    .then(token => {
      return Users.findBy({ "users.id": uid })
        .first()
        .then(user => {
          return res.status(200).json({ ...user, token });
        })
        .catch(error => res.status(500).json({ error }));
    })
    .catch(error => {
      if (error.code === "auth/wrong-password") {
        return res.status(403).json({
          general: "Incorrect Username/Password combination. Please try again."
        });
      } else if (error.code === "auth/user-not-found") {
        return res.status(403).json({ general: "User not found in system" });
      } else if (error.code === "auth/invalid-email") {
        return res.status(403).json({ general: "Invalid Email input." });
      } else {
        console.log(error);
        return res.status(500).json({ error: error.code });
      }
    });
});

router.post("/forgotPassword", (req, res) => {
  const { email } = req.body;
  const auth = firebase.auth();

  auth
    .sendPasswordResetEmail(email)
    .then(() => {
      return res.status(200).json({
        success: "Please check your inbox for the password reset e-mail."
      });
    })
    .catch(error => {
      console.log(error);
      return res.status(500).json({ error });
    });
});

router.post("/changeEmail", FBauth, (req, res) => {
  const { newEmail } = req.body;
  const user = firebase.auth().currentUser;

  user
    .updateEmail(newEmail)
    .then(() => {
      return res.status(200).json({
        success: `Your email address has been changed to ${newEmail}`
      });
    })
    .catch(error => {
      console.log(error);
      res.status(500).json({ error: "Unable to update email address." });
    });
});

router.post("/invite", FBauth, async (req, res) => {
  const { organization_id } = await Users.findBy({
    "users.id": req.uid
  }).first();

  const { role_id, name, email } = req.body;

  const contents = { organization_id, role_id };

  const sg_api_key = process.env.SG_API_KEY;
  const template_id = process.env.SG_TEMPLATE_ID;
  const registration_url = process.env.REGISTER_URL;
  const invite_token = signInvite(contents);

  const config = {
    headers: {
      Authorization: `Bearer ${sg_api_key}`
    }
  };

  const data = {
    personalizations: [
      {
        to: [{ email, name }],
        dynamic_template_data: { registration_url, invite_token }
      }
    ],
    from: {
      email: "invitation@schematiccapture.com",
      name: "Schematic Capture"
    },
    template_id
  };

  axios
    .post("https://api.sendgrid.com/v3/mail/send", data, config)
    .then(() =>
      res
        .status(202)
        .json({ message: `successfully sent invitation to ${email}` })
    )
    .catch(error => res.status(500).json({ error: error.message }));
});

function signInvite(contents) {
  const secret = process.env.INVITE_SECRET;
  const options = { expiresIn: "1hr" };

  return jwt.sign(contents, secret, options);
}

module.exports = router;
