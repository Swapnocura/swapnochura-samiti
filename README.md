# স্বপ্নচূড়া সমিতি — Starter MVP

এই ফোল্ডারে GitHub Pages-এর জন্য `index.html` এবং Firestore-এর প্রাথমিক Security Rules আছে। এটি একটি starter scaffold; পূর্ণাঙ্গ হিসাব/লেনদেন ব্যবস্থা হিসেবে এখনই ব্যবহার করবেন না।

## 1. GitHub-এ আপলোড
1. `swapnochura-samiti` repository খুলুন।
2. Add file → Upload files চাপুন।
3. ZIP extract করে ভেতরের `index.html`, `firestore.rules`, `README.md` ফাইলগুলো repository root-এ আপলোড করুন (ZIP ফাইল নিজে নয়)।
4. Commit changes করুন।

## 2. প্রথম Admin লগইন তৈরি
1. Firebase Console → Authentication → Users → Add user দিয়ে Admin-এর email/password তৈরি করুন।
2. তৈরি হওয়া user-এর UID কপি করুন।
3. Firestore Database → Data → Start collection: `users`।
4. Document ID হিসেবে ঠিক সেই UID দিন।
5. Fields যোগ করুন:
   - `role` (string) = `admin`
   - `name` (string) = `সমিতির Admin`
   - `permissions` (map) = খালি map `{}`
6. Save করুন। তারপর ওয়েবসাইটে ঐ email/password দিয়ে লগইন করুন।

## 3. Firestore Security Rules
Firebase Console → Firestore Database → Rules-এ `firestore.rules` ফাইলের বিষয়বস্তু বসিয়ে Publish করুন। Admin user document না বানিয়ে আগে Rules publish করলে কোনো user ডেটা পড়তে/লিখতে পারবে না—এটি প্রত্যাশিত নিরাপত্তা আচরণ।

## 4. GitHub Pages
Repository → Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/(root)` → Save. কিছুক্ষণ পরে Pages URL তৈরি হবে.

## 5. Staff profile
Admin-কে Authentication → Users থেকে staff user তৈরি করতে হবে, তারপর Firestore `users/{staffUID}` document বানাতে হবে:
- `role`: string `staff`
- `name`: string কর্মীর নাম
- `permissions`: map, যেমন `members: true`, `deposit: true`, `collection: true`

## সতর্কতা — গুরুত্বপূর্ণ
- Firebase Web config browser-এ থাকার জন্যই তৈরি; এটি Admin private key নয়। কখনো Service Account JSON/private key GitHub-এ দেবেন না।
- এই starter-এ form থেকে Firestore-এ রেকর্ড লেখা ও সাধারণ তালিকা দেখানোর ভিত্তি আছে, কিন্তু member ID unique assignment, ব্যালেন্স/স্টক atomic update, loan installment schedule, approval-safe refund execution, duplicate receipt prevention, cancellation/reversal, robust reports and audit trail এখনো production-ready নয়।
- `firestore.rules` হলো প্রাথমিক role/permission gate। বাস্তব অর্থনৈতিক ব্যবহারের আগে security review এবং হিসাবের সার্ভার-সাইড/atomic validation দরকার।
- বাস্তব সদস্যের ব্যক্তিগত/আর্থিক তথ্য এখনই দেবেন না। প্রথমে test data দিয়ে পরীক্ষা করুন।
