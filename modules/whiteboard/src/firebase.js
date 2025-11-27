// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "",
  authDomain: "hotcode-whiteboard-module.firebaseapp.com",
  projectId: "hotcode-whiteboard-module",
  storageBucket: "hotcode-whiteboard-module.firebasestorage.app",
  messagingSenderId: "629694389704",
  appId: "1:629694389704:web:5477af32670547fedf34fd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

export default app;

