import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { doc, getDoc, getDocs } from "firebase/firestore";
import { collection, query, where } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB6ETazElRvln2HBQR3o6x0flQs-5OTDks",
  authDomain: "flow-wise-15f75.firebaseapp.com",
  projectId: "flow-wise-15f75",
  storageBucket: "flow-wise-15f75.firebasestorage.app",
  messagingSenderId: "841015230132",
  appId: "1:841015230132:web:0f176186deaafa8da8a1e1",
  measurementId: "G-X384PGB6SS",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// var q = query(collection(db, "users"), where("1", "==", "1"));
// var docs = await getDocs(q);

// docs.forEach((doc) => {
//   docs.docs.map((doc) => doc.data());
// });

async function getDocsFromCollection(collectionName) {
  var q = query(collection(db, collectionName));
  let querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => doc.data());
}
const users = await getDocsFromCollection("users");

console.log("ok");
