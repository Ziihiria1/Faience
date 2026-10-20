// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDCncddbe91vZfprGhUMXszgH5X_KOuv10",
  authDomain: "jeuxa2.firebaseapp.com",
  databaseURL: "https://jeuxa2-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jeuxa2",
  storageBucket: "jeuxa2.firebasestorage.app",
  messagingSenderId: "540546207305",
  appId: "1:540546207305:web:f45ec9027abf8d2d6ff998",
  measurementId: "G-7HPY90Q4J3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);