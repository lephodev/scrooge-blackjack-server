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
const RATE_LIMIT_WINDOW = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const rateLimitStore = {};

const Basicauth = (req, res, next) => {
  const tokenHeaders = req.headers;
  const tokenResponse = tokenHeaders?.authorization;

  if (tokenResponse === undefined) {
    let err = new Error("You are not authenticated!");
    err.status = 401;
    return res.status(401).send({ msg: "Acces denied" });
  }

  const tokenParts = tokenResponse.split(" ");
  if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
    let err = new Error("Invalid Token!");
    err.status = 401;
    return res.status(401).send({ msg: "Invalid token format" });
  }

  const clientToken = DecryptCard(tokenParts[1]);
  const encodedPart = clientToken.split("/");
  if (encodedPart[0] !== process.env.TOKEN_ENCRYPTION_STRING) {
    let err = new Error("Invalid Token!");
    err.status = 401;
    return res.status(401).send({ msg: "Invalid token" });
  }

  if (!rateLimitStore[encodedPart[1]]) {
    rateLimitStore[encodedPart[1]] = { count: 1, lastRequestTime: Date.now() };
  } else {
    const timeDifference =
      Date.now() - rateLimitStore[encodedPart[1]].lastRequestTime;

    if (timeDifference < RATE_LIMIT_WINDOW) {
      rateLimitStore[encodedPart[1]].count += 1;
      if (rateLimitStore[encodedPart[1]].count > MAX_REQUESTS_PER_WINDOW) {
        return res
          .status(429)
          .json({ error: "Too many requests, please try again later." });
      }
    } else {
      rateLimitStore[encodedPart[1]] = {
        count: 1,
        lastRequestTime: Date.now(),
      };
    }
  }
  rateLimitStore[encodedPart[1]].lastRequestTime = Date.now();

  next();
};
export default Basicauth;
