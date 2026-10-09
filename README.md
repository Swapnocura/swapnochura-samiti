# স্বপ্নচূড়া সমিতি — আপডেট প্যাকেজ

## প্যাকেজে কী আছে
- `index.html` — ওয়েবসাইটের আপডেটেড ফাইল (হ্যামবার্গার ☰ মেনু, পাসবই সার্চ, সঞ্চয় ফেরতের অনুমোদন এবং হেডারে logo.png দেখানোর ব্যবস্থা)।
- `firestore.rules` — Firebase Firestore Rules; এটি GitHub-এ আপলোড করলেই চালু হবে না।

## GitHub Pages-এ ফাইল আপডেট
1. ZIP ফাইলটি ফোনে Extract করুন।
2. `swapnochura-samiti` GitHub repository খুলুন।
3. `index.html`-এর পুরোনো ফাইলটি নতুন `index.html` দিয়ে Replace/Commit করুন। `README.md` চাইলে আপলোড করতে পারেন। ZIP ফাইলটি সরাসরি আপলোড করবেন না—GitHub Pages ZIP খুলে ওয়েবসাইট চালায় না।
4. `logo.png` ফাইলটি একই repository-র root-এ (index.html-এর পাশে) থাকতে হবে। এটি আগে থেকেই সেখানে থাকলে আবার আপলোডের প্রয়োজন নেই। ওয়েবসাইটে `./logo.png` পথ ব্যবহার করা হয়েছে।

## Firebase Rules প্রকাশ
1. Firebase Console → Firestore Database → Rules খুলুন।
2. এই প্যাকেজের `firestore.rules` ফাইলের সম্পূর্ণ লেখা কপি করে Rules-এ বসান।
3. Publish চাপুন।

## গুরুত্বপূর্ণ
এই MVP-র JavaScript syntax পরীক্ষা করা হয়েছে, কিন্তু লাইভ Firebase-এ end-to-end পরীক্ষা করা হয়নি। প্রথমে পরীক্ষামূলক সদস্য/লেনদেন দিয়ে পরীক্ষা করুন; যাচাই না করে বাস্তব আর্থিক হিসাবের একমাত্র রেকর্ড হিসেবে ব্যবহার করবেন না। Firebase Rules প্রকাশের আগে বর্তমান Rules-এর ব্যাকআপ রাখুন।
