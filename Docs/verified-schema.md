# বর্তমান অ্যাপ source থেকে দেখা schema

- `members`: `memberNo`, `name`, `phone`; কিছু display fallback-এ `mobile`, `phoneNumber` দেখা যায়।
- `loans`: `loanNo`, `memberNo`, `memberName`, `principal`, `installmentAmount`, `installments`, `installmentType`, `startDate`, `nextInstallmentDate` (custom type), `status`।
- `collections`: `memberNo`, `memberName`, `loanNo`, `amount`, `date`, `status`, `paymentFor`। Admin collection submission-এ `status: "approved"`; staff submission-এ `pending`, পরে admin approve/reject করে।

Due-date calculation used by the current UI alert preview: approved-ish collections sum by loanNo; paid installment count is floor(total approved amount / installmentAmount); due = startDate + (nextIndex - 1) × interval, with weekly=7, fortnightly=15, otherwise 30. The backend matches this alert-preview behavior, excluding `pending` and `rejected`; legacy records without status count as paid. It skips custom recurring schedules beyond the first custom due date.
