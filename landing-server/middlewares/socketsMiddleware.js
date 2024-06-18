import { decryptPass } from "../utils/decrypt.js";
import jwt from "jsonwebtoken";

const socketsAuthentication = async (handshake)=>{
    try{
        let token = "";
        let mode = "";
        const cookieData = handshake?.headers?.cookie;
        const cookieDetails = cookieData?.split(";");
        cookieData &&
        cookieDetails?.length > 0 &&
        cookieDetails?.forEach((el) => {
            if (el.includes("token=")) {
            token = el;
            }
            if (el.includes("mode=")) {
            mode = el;
            }
        });
        const tokenForVerify = token?.split("token=")[1];
        console.log("tokenForVerify ==>", tokenForVerify);
        let decryptedToken = decryptPass(tokenForVerify);
        const verify = await verifyJwt(decryptedToken);
        return { userId: verify?.sub, success: true };
    }catch(err){
        return new Error('Authentication failed');
    }
}

const verifyJwt = (token) => {
    return new Promise(async (resolve, reject) => {
      try {
        const isTokenValid = jwt.verify(token, process.env.JWT_SECRET);
        if (isTokenValid) {
          resolve(isTokenValid);
        }
      } catch (e) {
        console.log("ererer", e);
        reject(false);
      }
    });
  };

export default socketsAuthentication;