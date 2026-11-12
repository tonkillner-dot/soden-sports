// Firebase Configuration for Project: soden-sports-2569
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCHEe0FT84o8qWem1GLUTU3WKGpiQUiOR0",
  authDomain: "soden-sports-2569.firebaseapp.com",
  projectId: "soden-sports-2569",
  storageBucket: "soden-sports-2569.firebasestorage.app",
  messagingSenderId: "401428915556",
  appId: "1:401428915556:web:2defe36b6a69f679b88671"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export {
  db,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  writeBatch,
  getDocs
};
