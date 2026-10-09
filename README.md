# স্বপ্নচূড়া পণ্য ঋণ বিতরণ সমিতি — MVP আপডেট

## প্যাকেজে থাকা ফাইল
- `index.html`: আগের নকশা অপরিবর্তিত রেখে Admin/কর্মী প্যানেলের আপডেট।
- `firestore.rules`: সদস্য ও ঋণ নম্বর কাউন্টার, কালেকশন অনুমোদন এবং রিপোর্টের জন্য Firestore নিরাপত্তা নিয়ম।
- `README.md`: ইনস্টল, লগইন পরিবর্তন, Firebase Rules এবং পরীক্ষার নির্দেশনা।
- `logo.png`, `manifest.webmanifest`, `sw.js`: বর্তমান লোগো ও PWA ফাইল (অক্ষত রাখা হয়েছে)।

## নতুন/আপডেট ফিচার
- সদস্য নম্বর স্বয়ংক্রিয়ভাবে `01`, `02`, ... `99`, `100` ইত্যাদি হবে। আগের সদস্য থাকলে তার সর্বোচ্চ নম্বরের পরের নম্বর নেবে। নম্বর তৈরি Firestore transaction/counter দিয়ে করা হয়, যাতে একই সময়ে একাধিক সদস্য তৈরি হলেও নতুন অ্যাপের মধ্যে সিরিয়াল সংঘর্ষ কমে। পুরোনো নম্বরের শুরুতে অতিরিক্ত শূন্য থাকলে lookup তা স্বাভাবিক করে।
- ঋণ রেকর্ডে স্বয়ংক্রিয় `LN-0001` ধরনের ঋণ নম্বর।
- নতুন Daily Collection Sheet: তারিখ নির্বাচন, কর্মীভিত্তিক ও সদস্যভিত্তিক সারাংশ, নগদ ঋণ/পণ্য বিক্রয়/পণ্য ঋণ আলাদা হিসাব, মোট জমা দেওয়া, Admin-অনুমোদিত ও অপেক্ষমাণ আদায়, আনুমানিক অবশিষ্ট ঋণ, Print/Save as PDF।
- কর্মী জমা দেওয়া নতুন কালেকশন Pending হবে; Admin অনুমোদন বা প্রত্যাখ্যান করতে পারবেন। Pending/পুরোনো যাচাই-না-করা রেকর্ডকে অনুমোদিত আদায়ে ধরা হয় না।
- বাংলা/English ভাষা বদলানোর বোতাম। ভাষা পছন্দ একই ব্রাউজারে রাখা হয়।
- আগের ফিচার: সেটিংসে পাসওয়ার্ড পরিবর্তন, সদস্য নম্বর দিয়ে সদস্যের তথ্য আনা, পণ্য বিক্রির ইনভয়েস কপি, ইনভয়েস দিয়ে ঋণ ফর্ম পূরণ, জমা বাদে বাকি ঋণ ও কিস্তির হিসাব।

## GitHub আপলোড
1. ZIP Extract করুন।
2. `index.html`, `firestore.rules`, `README.md` GitHub Repository root-এ upload/replace করুন।
3. ZIP-এর `logo.png`, `manifest.webmanifest`, `sw.js`-সহ সব ফাইল একই root-এ রাখুন। লোগো বা PWA ফাইল মুছবেন না।
4. GitHub Pages deployment শেষ হলে `https://swapnochura-samiti.github.io/` খুলুন।

## প্রথমবার Admin ইউজারনেম চালু করা
1. বর্তমান Admin লগইন দিয়ে সাইট খুলুন।
2. **সেটিংস → অ্যাডমিন ইউজারনেম সেটআপ**-এ `swapnochura.com`-এর জন্য নতুন পাসওয়ার্ড দিন এবং নিশ্চিত করুন।
3. সফল হলে সিস্টেম লগআউট করবে। এরপর ইউজারনেম `swapnochura.com` এবং নতুন পাসওয়ার্ড দিয়ে লগইন করুন।
4. সেটআপের আগে নিশ্চিত করুন Firebase Authentication-এ `swapnochura.com@login.swapnochura.com` নামে অ্যাকাউন্ট আগে থেকে নেই।

## Firebase Rules Publish
GitHub-এ `firestore.rules` আপলোড করলেই Firebase Rules বদলায় না। Firebase Console → `swapnochura-samiti` → Firestore Database → Rules-এ নতুন `firestore.rules`-এর সম্পূর্ণ লেখা বসিয়ে Publish করুন। Rules পরিবর্তনের আগে পুরোনো Rules-এর কপি রাখুন।

## কর্মী অ্যাকাউন্ট ও নিরাপত্তা
- কর্মী তৈরি/সক্রিয়/নিষ্ক্রিয় করতে Admin হিসেবে **সেটিংস** খুলুন।
- কর্মী নিষ্ক্রিয় করলে অ্যাপ থেকে বের করে দেওয়া হয় এবং আপডেট করা Rules অনুযায়ী ডেটা পড়া/লেখা বন্ধ হয়। এটি Firebase Authentication account মুছে দেয় না; এটি অ্যাপের Firestore অ্যাক্সেস বন্ধ করে।
- `firestore.rules`-এর সম্পূর্ণ লেখা Firebase Console-এ Publish করা জরুরি। শুধু GitHub-এ ফাইল বদলালে নিরাপত্তা নিয়ম কার্যকর হবে না।
- এটি বিনামূল্যের Firebase Auth + Firestore ব্যবস্থার ক্লায়েন্ট-সাইড অ্যাকাউন্ট তৈরি; Cloud Functions যোগ করা হয়নি। Firebase-এর বর্তমান free quota/নীতি প্রযোজ্য।

## পরীক্ষার ক্রম
1. Admin লগইন এবং Dashboard খুলছে কি না।
2. পরীক্ষামূলক সদস্য তৈরি করুন; প্রথম নম্বর `01` হবে যদি কোনো সদস্য না থাকে।
3. দুইটি সদস্য দ্রুত ধারাবাহিকভাবে তৈরি করে নম্বর আলাদা হচ্ছে কি না দেখুন।
4. সদস্য নম্বর দিয়ে অন্য ফর্মে খুঁজে নাম, ফোন ও ঠিকানা আসছে কি না দেখুন।
5. পরীক্ষামূলক ঋণ তৈরি করে `LN-...` ঋণ নম্বর দেখুন।
6. কর্মী হিসেবে পরীক্ষামূলক কালেকশন দিলে Pending হয় কি না, Admin হিসেবে অনুমোদন করলে Daily Collection Sheet-এ Approved-এ যোগ হয় কি না দেখুন।
7. Daily Collection Sheet-এ তারিখ পরিবর্তন, Print এবং ব্রাউজার Print → Save as PDF পরীক্ষা করুন।
8. English/বাংলা বোতাম, পাসওয়ার্ড পরিবর্তন, পণ্য বিক্রি ও invoice-to-loan পরীক্ষা করুন।

## সতর্কতা
এটি এখনও MVP; লাইভ Firebase-এ পূর্ণ end-to-end পরীক্ষা বা স্বাধীন আর্থিক নিরীক্ষা হয়নি। বাস্তব আর্থিক লেনদেনের আগে পরীক্ষামূলক তথ্য দিয়ে সব অনুমতি, অনুমোদন, ব্যালেন্স ও রিপোর্ট যাচাই করুন। Rules পরিবর্তনের পর কর্মীদের permission ও বিদ্যমান `users/{uid}` প্রোফাইলও যাচাই করুন।

## নতুন পরিকল্পিত ফিচারসমূহ (অক্টোবর ২০২৬ বিল্ড)

এই বিল্ডে বর্তমান অ্যাপের ওপর গ্রাম ব্যবস্থাপনা, সদস্য NID ও পিতা/স্বামীর নাম, সদস্য গ্রাম স্থানান্তর, পণ্য গ্রুপ ও ব্র্যান্ড, পণ্য বারকোড ও ন্যূনতম স্টক সতর্কতা, বিক্রয় রিটার্ন, কাস্টমার সার্ভিসিং, কর্মী বেতন এন্ট্রি, তারিখভিত্তিক কিছু রিপোর্ট এবং ড্যাশবোর্ডে ঋণ/বিক্রয় সারাংশ যোগ করা হয়েছে। পণ্য বিক্রিতে পণ্য কোড মেলানো হলে স্টক কমে এবং পুনরায় বিক্রয়যোগ্য রিটার্নে স্টক বাড়ে।

### আপডেট করার আগে জরুরি
1. লাইভ সাইট রিপ্লেস করার আগে পুরো রিপোজিটরি এবং Firebase/Firestore ডেটার আলাদা ব্যাকআপ নিন।
2. `firestore.rules`-এ নতুন `villages`, `productGroups`, `brands`, `returns`, `serviceEntries`, `payroll` collection-এর নিয়ম যোগ করা হয়েছে। Firebase Console → Firestore Database → Rules-এ নিয়মগুলো পর্যালোচনা করে Publish করতে হবে, নইলে নতুন স্ক্রিনে permission error হতে পারে।
3. প্রথমে আলাদা টেস্ট কপি/টেস্ট Firebase-এ যাচাই করুন। সরাসরি লাইভ রিপ্লেস করলে ভুল হিসাব বা permission সমস্যা হতে পারে।
4. নতুন `villages` collection-এ গ্রাম তৈরি করে তারপর সদস্য যোগ করুন; পুরোনো সদস্যদের village মান আগে থেকেই টেক্সট হিসেবে থাকলে সেগুলো স্বয়ংক্রিয়ভাবে village collection-এ তৈরি হবে না।

### পরীক্ষার সীমা
এই ZIP-এর JavaScript syntax পরীক্ষা করা হয়েছে, কিন্তু বাস্তব Firebase প্রজেক্টে লগইন, Firestore Rules, হিসাবের সব পরিস্থিতি, বারকোড স্ক্যানার, প্রিন্টার, মোবাইল/PWA বা লাইভ ডেটা দিয়ে end-to-end পরীক্ষা করা হয়নি। বিশেষ করে পুরোনো কালেকশন ডেটায় `loanNo` না থাকলে ড্যাশবোর্ডের বকেয়া ঋণের অঙ্ককে যাচাই ছাড়া চূড়ান্ত হিসাব হিসেবে ব্যবহার করবেন না।


## Corrected build (2026-10-09)

This package includes targeted fixes: daily collection sheet defaults to all members, daily approved savings/loan collection amounts are rendered and totaled, and sale creation plus stock decrement are performed in a Firestore transaction. Sales now preserve the product cost snapshot for later reporting, and the date-range sales report includes an invoice print action.

Validation performed for this package: JavaScript module syntax check and static checks only. No live Firebase credentials/session were available, so live login, Firestore rules, concurrent user behavior, PWA installation, and accounting reconciliation have not been end-to-end tested. This is not yet a guarantee that every requested feature is complete. Back up the current project and Firestore data before deployment.
