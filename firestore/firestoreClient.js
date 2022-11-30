import admin from "firebase-admin";
import { getStorage } from "firebase-admin/storage";

const ad = admin.initializeApp({
  projectId: "mycool-net-app",
  credential: admin.credential.applicationDefault(),
  storageBucket: "gs://mycool-net-app.appspot.com",
});
export const db = ad.firestore();
export const bucket = getStorage();
export const auth = ad.auth();
