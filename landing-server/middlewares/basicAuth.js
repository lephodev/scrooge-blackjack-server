import CryptoJS from "crypto-js";

const DecryptCard = (cipher) => {
  // Decrypt
  const PUBLICK_KEY = "AC2d27e9ad2978d70ffb5637ce05542073";
  if (cipher) {
    var bytes = CryptoJS.AES.decrypt(cipher, PUBLICK_KEY);
    var originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText;
  }
};
const Basicauth = (req, res, next) => {
  try {
    const authheader = req.headers.authorization;
    if (!authheader) {
      let err = new Error("You are not authenticated!");
      res.setHeader("WWW-Authenticate", "Basic");
      err.status = 401;
      return res.status(401).send({ msg: "Acces denied" });
    }
    let authValue = authheader?.split(" ");
    if (authValue.length < 2) {
      let err = new Error("You are not authenticated!");
      res.setHeader("WWW-Authenticate", "Basic");
      err.status = 401;
      return res.status(401).send({ msg: "Acces denied" });
    }
    const finalAuthHeader = DecryptCard(authValue[1]);
    const auth = new Buffer.from(finalAuthHeader, "base64")
      .toString()
      .split(":");
    const user = auth[0];
    const pass = auth[1];

    const getPass = new Date().toISOString();
    const newDt = new Date(getPass).getTime();

    var difference = newDt - pass;
    var daysDifference = Math.floor(difference / 1000);
    if (user == "scr@@ze" && daysDifference < 10) {
      // If Authorized user
      next();
    } else {
      let err = new Error("You are not authenticated!");
      res.setHeader("WWW-Authenticate", "Basic");
      err.status = 401;
      return res.status(401).send({ msg: "Access denied" });
    }
  } catch (error) {
    console.log("error", error);
  }
};

export default Basicauth;