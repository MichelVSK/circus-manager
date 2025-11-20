// app.js (module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  applyActionCode,
  checkActionCode,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, query, where, doc, setDoc, getDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";

/* ---------------- init ---------------- */
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ---------------- Helpers ---------------- */
function normalizeEmailKey(email) {
  return email.toLowerCase().replace(/\./g, "_");
}

/* Pending registrations: stored while waiting verification */
export async function savePendingRegistration(obj) {
  // obj: {nom, prenom, email, livegame}
  const id = normalizeEmailKey(obj.email);
  await setDoc(doc(db, "pending_registrations", id), { ...obj, createdAt: new Date() });
}

export async function removePendingRegistration(email) {
  const id = normalizeEmailKey(email);
  try { await deleteDoc(doc(db, "pending_registrations", id)); } catch(e){/*ignore*/ }
}

export async function getPendingRegistration(email) {
  const id = normalizeEmailKey(email);
  const d = await getDoc(doc(db, "pending_registrations", id));
  return d.exists() ? d.data() : null;
}

/* Create croupier doc after email verification */
export async function createCroupierFromPending(email) {
  const pending = await getPendingRegistration(email);
  if (!pending) return false;
  // If same email already in croupiers, skip creation
  const q = query(collection(db, "croupiers"), where("email", "==", email));
  const snap = await getDocs(q);
  if (!snap.empty) {
    await removePendingRegistration(email);
    return true;
  }
  await addDoc(collection(db, "croupiers"), {
    nom: pending.nom || "",
    prenom: pending.prenom || "",
    email: pending.email,
    livegame: !!pending.livegame,
    priorite: 3,
    createdAt: new Date()
  });
  await removePendingRegistration(email);
  return true;
}

/* Upload event image (max 2MB check should be done on client) */
export async function uploadEventImage(file) {
  if (!file) return null;
  // validate file size & type basic
  const maxBytes = 2 * 1024 * 1024; // 2MB
  if (file.size > maxBytes) throw new Error("File too large (2MB max)");
  const allowed = ["image/jpeg","image/png","image/webp"];
  if (!allowed.includes(file.type)) throw new Error("Invalid file type");
  const fname = `${Date.now()}-${file.name.replace(/\s+/g,"_")}`;
  const ref = sref(storage, `event-images/${fname}`);
  const snap = await uploadBytes(ref, file);
  const url = await getDownloadURL(snap.ref);
  return url;
}

/* Export CSV helper (semicolon separated for Excel FR) */
export async function exportEventCSV(eventId) {
  // get event doc
  const evSnap = await getDocs(collection(db, "evenements"));
  const evDoc = evSnap.docs.find(d => d.id === eventId);
  if (!evDoc) throw new Error("Event not found");
  const ev = evDoc.data();

  // all postulations
  const postsSnap = await getDocs(collection(db, "postulations"));
  const posts = postsSnap.docs.filter(p => p.data().eventId === eventId);

  // croupiers
  const cSnap = await getDocs(collection(db,"croupiers"));

  let csv = `"${ev.nom}"\r\n`;
  csv += "NOM;PRENOM;MAIL;DEBUT;FIN;PRIORITE\r\n";

  for (const pDoc of posts) {
    const p = pDoc.data();
    const c = cSnap.docs.find(cd => cd.data().email.toLowerCase() === p.email.toLowerCase());
    const nom = c ? (c.data().nom || "") : "";
    const prenom = c ? (c.data().prenom || "") : "";
    const prio = c ? (c.data().priorite || "") : "";
    const safe = s => (s||"").toString().replace(/[\r\n;]/g," ");
    csv += `${safe(nom)};${safe(prenom)};${safe(p.email)};${safe(p.debut)};${safe(p.fin)};${safe(prio)}\r\n`;
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ev.nom}-dispo.csv`;
  a.click();
}

/* Utility: create or update a postulation (one per email+event) */
export async function upsertPostulation(eventId, email, debut, fin) {
  // find existing
  const q = query(collection(db, "postulations"), where("eventId", "==", eventId), where("email", "==", email));
  const snap = await getDocs(q);
  if (snap.empty) {
    await addDoc(collection(db, "postulations"), { eventId, email, debut, fin, createdAt: new Date() });
    return { created: true };
  } else {
    const ref = snap.docs[0].ref;
    await updateDoc(ref, { debut, fin, updatedAt: new Date() });
    return { updated: true };
  }
}
