// ─────────────────────────────────────────────
// OmniPlot — FIREBASE CLIENT
// ─────────────────────────────────────────────
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getFunctions, type Functions } from "firebase/functions";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

// ─── Config (replace with actual env vars in .env) ───
const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// ─── Singleton init ───────────────────────────
let app: FirebaseApp;
let auth: Auth;
let db: Firestore;
let storage: FirebaseStorage;
let functions: Functions;
let analytics: Analytics | null = null;

function initFirebase() {
	if (getApps().length === 0) {
		app = initializeApp(firebaseConfig);
	} else {
		app = getApps()[0];
	}

	auth = getAuth(app);
	db = getFirestore(app);
	storage = getStorage(app);
	functions = getFunctions(app);

	// Analytics only in browser
	if (typeof window !== "undefined") {
		isSupported().then((supported) => {
			if (supported) analytics = getAnalytics(app);
		});
	}
}

// Initialize on import (client-side only)
if (typeof window !== "undefined") {
	initFirebase();
}

export { app, auth, db, storage, functions, analytics };
