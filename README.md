# স্বপ্নচূড়া সমিতি — SMS-only কিস্তি রিমাইন্ডার

এই প্যাকেজটি বর্তমান অ্যাপের যাচাই করা collection/field নাম ব্যবহার করে: `members`, `loans`, `collections`। WhatsApp integration নেই। বিদ্যমান HTML ফাইল পরিবর্তন করে না।

## এটি কী করে
- প্রতিদিন বাংলাদেশ সময় সকাল ৯টায় scheduled function চালায়।
- নির্ধারিত কিস্তির ঠিক ২ দিন আগে এবং নির্ধারিত দিনেই SMS candidate তৈরি করে।
- `members.phone` (fallback `mobile`/`phoneNumber`) থেকে নম্বর নেয়; `01XXXXXXXXX` ও `8801XXXXXXXXX` গ্রহণ করে।
- বর্তমান অ্যাপের alert preview-এর মতো `pending` ও `rejected` বাদ দিয়ে বাকি collection-কে পরিশোধ হিসেবে গণনা করে (পুরোনো status-বিহীন রেকর্ডও অন্তর্ভুক্ত)।
- একই loan + due date + alert stage-এর SMS পুনরায় পাঠানো আটকাতে `smsAlertLogs` ব্যবহার করে।
- SMS provider: sms.bd API.

## গুরুত্বপূর্ণ সীমাবদ্ধতা
- `weekly`, `fortnightly` এবং monthly loan-এর due date বর্তমান অ্যাপের দৃশ্যমান logic অনুযায়ী `startDate` থেকে যথাক্রমে ৭, ১৫, ৩০ দিন ব্যবধানে হিসাব করা হয়। মাসিক এখানে ৩০ দিন, ক্যালেন্ডার মাস নয়।
- `custom` installment-এ বর্তমান schema শুধু প্রথম `nextInstallmentDate` নিশ্চিত করে। তাই প্রথম কিস্তির জন্যই reminder বিবেচনা করা হয়; পরের custom কিস্তি স্বয়ংক্রিয়ভাবে অনুমান করা হয় না।
- Partial payment/একাধিক installment একসঙ্গে জমা হলে বর্তমান অ্যাপের মতো মোট approved collection ÷ installmentAmount থেকে পূর্ণ কিস্তির সংখ্যা হিসাব করা হয়। লাইভ চালুর আগে বাস্তব ঋণের উদাহরণ দিয়ে যাচাই করুন।
- `smsAlertLogs` collection server-side Firebase Admin SDK দিয়ে তৈরি হবে; সাধারণ app user-কে এই collection-এ সরাসরি write permission দিতে হবে না।
- প্রথমে dry-run চালাতে হবে। `SMS_ALERTS_ENABLED=true` না হওয়া পর্যন্ত কোনো SMS পাঠানো হবে না।

## প্রয়োজন
- Firebase CLI ও Node.js 20
- Firebase project-এ billing-enabled plan; Scheduler/Cloud Functions deploy করার সময় Firebase যে plan/permission চায় তা অনুসরণ করুন
- sms.bd account ও API key

## সেটআপ (কম্পিউটার/টার্মিনাল প্রয়োজন)
1. ZIP extract করুন।
2. Firebase Console-এ সঠিক project ID দেখে `.firebaserc.example`-কে `.firebaserc` নামে কপি করে `YOUR_FIREBASE_PROJECT_ID` বদলান।
3. Terminal-এ এই folder-এ যান, তারপর:
   - `npm --prefix functions install`
   - `firebase login`
   - `firebase use YOUR_FIREBASE_PROJECT_ID`
   - `firebase functions:secrets:set SMS_API_KEY`
4. Secret prompt-এ sms.bd API key দিন। API key চ্যাটে বা source code-এ দেবেন না।
5. Dry-run অবস্থায় deploy করুন:
   - `firebase deploy --only functions:installmentReminderScheduler`
6. Firebase Console → Functions → Logs-এ `SMS dry run only` ও candidate count দেখুন। কোনো SMS যাবে না।
7. কিস্তির তারিখ, member phone, approved collection এবং candidate list সঠিক কিনা যাচাই করুন।
8. তারপর project folder-এ `.env.YOUR_FIREBASE_PROJECT_ID` নামে ফাইল তৈরি করে শুধু এই লাইন দিন: `SMS_ALERTS_ENABLED=true`। এরপর আবার function deploy করুন। Firebase parameter prompt থাকলে `true` নির্বাচন করুন।
9. প্রথম লাইভ পরীক্ষায় নিজের নিয়ন্ত্রিত নম্বরসহ একটি test loan ব্যবহার করুন; SMS balance ও charges sms.bd panel-এ দেখুন।

## API
Endpoint ও parameter sms.bd-র প্রকাশিত API docs অনুযায়ী: `https://api.sms.net.bd/sendsms`, parameters `api_key`, `to`, `msg`। API response `error: 0` হলে request accepted হয়; এটি handset delivery নিশ্চিত করে না। API docs: https://sms.bd/api

## নিরাপত্তা
- `SMS_API_KEY` শুধু Firebase Secret Manager-এ রাখুন।
- ZIP-এ API key, Firebase private key বা কোনো account password নেই।
- এই ZIP deploy করলেই আপনার Firebase/GitHub নিজে থেকে পরিবর্তিত হবে না; deployment আপনার Firebase project-এ করতে হবে।
