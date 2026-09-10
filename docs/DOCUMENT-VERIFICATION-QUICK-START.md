# Document Verification - Quick Start Guide

## 🎯 What's New?

A complete system to **verify customer identification documents before sending contracts**, with a **firewall override** for exceptional cases.

**Problem solved:**
- ❌ USA and other countries have strict identity verification requirements
- ❌ Without docs, contracts can't be legally signed
- ❌ No way to block contract sending without docs

**Solution:**
- ✓ Blocks contract sending until documents are verified
- ✓ Allows closers/admins to override in exceptional cases (logged for audit)
- ✓ Works with any country (Spain, USA, Mexico, etc.)

---

## 📋 Files Created

| File | Purpose |
|------|---------|
| `scripts/migration-v47-document-verification.sql` | Database schema update |
| `lib/contracts/document-requirements.ts` | Country-specific requirements |
| `app/api/evergreen/documents/verify/route.ts` | Upload documents endpoint |
| `app/api/evergreen/documents/override/route.ts` | Firewall override endpoint |
| `app/api/evergreen/documents/state/route.ts` | Check verification status |
| `components/sales/DocumentVerificationSection.tsx` | React UI component |
| `docs/DOCUMENT-VERIFICATION-IMPLEMENTATION.md` | Full technical docs |
| `docs/DOCUMENT-VERIFICATION-USAGE-EXAMPLES.md` | Code examples & scenarios |

---

## 🚀 Implementation Steps (15 minutes)

### Step 1: Run Database Migration
```bash
# Open Supabase SQL editor and copy-paste:
# /scripts/migration-v47-document-verification.sql

# Or run directly:
# psql -h <supabase-host> -U postgres < scripts/migration-v47-document-verification.sql
```

### Step 2: Create Storage Bucket
In Supabase → Storage → New Bucket:
- **Name:** `documentos-verificacion`
- **Public:** No (private bucket)
- **File size limit:** 10 MB

### Step 3: Add UI Component to Sales Page

Open `/app/evergreen/sales/[id]/page.tsx` and add:

```tsx
// Add import
import { DocumentVerificationSection } from '@/components/sales/DocumentVerificationSection'

// In the component JSX, add after contract section:
<DocumentVerificationSection
  saleId={saleId}
  contactCountry={sale.contacts?.country}
  contactEmail={sale.contacts?.email}
  userRole={userRole} // Get from auth context
/>
```

### Step 4: Update Contract Sending (Already Done ✓)

The endpoint `/api/evergreen/contracts/student` already checks for:
```typescript
// ✓ Modified in step 1
if (!docsVerified) {
  return NextResponse.json({
    error: 'Document verification required'
  }, { status: 403 })
}
```

### Step 5: Test It

1. Create a sale from **USA**
2. Go to sales detail page
3. See **"Document Verification Required"** section (amber)
4. Try to send contract → **blocked** ✓
5. Click **"Apply Override"** → set reason
6. Try to send contract → **allowed** ✓
7. Check audit trail in database

---

## 🎮 Using the System

### As a Closer (Normal Case)
```
1. Customer pays (USA)
2. System shows: "⚠️ Document Verification Required"
3. Send link to customer to upload passport
4. Customer uploads → Admin verifies
5. System shows: "✅ Documents Verified"
6. Click "Send Contract" → Works ✓
```

### As a Closer (Override Case)
```
1. Customer paid but can't upload docs
2. You need to send contract NOW
3. Click "Apply Override" button
4. Enter reason: "Customer ready for onboarding, docs coming later"
5. System shows: "⚡ Override Applied"
6. Click "Send Contract" → Works ✓
7. Action logged for audit: who, when, why
```

### As an Admin (Verify Documents)
```sql
-- Find pending documents
SELECT * FROM document_verifications WHERE status = 'pending';

-- Review document (visit signed URL in document_url column)

-- Mark as verified
UPDATE document_verifications
SET status = 'verified', verified_at = NOW(), verified_by = 'your-id'
WHERE id = '...';

UPDATE sales
SET documents_verified = true, documents_verified_at = NOW()
WHERE id = (SELECT sale_id FROM document_verifications WHERE id = '...');
```

---

## 🔍 What Gets Blocked & Why

| Scenario | Block? | Why |
|----------|--------|-----|
| Spain sale, no docs | ❌ Block | ES requires DNI/NIE/Passport |
| USA sale, no docs | ❌ Block | US requires Passport/ID (strict) |
| Any sale, docs verified | ✅ Allow | Verification complete |
| Any sale, override applied | ✅ Allow | Override logged, exception noted |
| Contract sending with no docs | ❌ Block | Returns 403 error |

---

## 🛡️ The Firewall (Override) System

**Who can override?**
- ✓ Admin
- ✓ Director
- ✓ Closer

**Why would you override?**
- Customer's technical issue uploading
- Time-sensitive case (customer ready to start)
- Documents being prepared (will upload later)
- Exceptional approval from director/legal

**What's logged?**
```sql
-- In sales table:
documents_verified_override = true          -- Marker
documents_override_reason = "..."           -- Your explanation
documents_override_by = "user-uuid"         -- Who did it
documents_override_at = "timestamp"         -- When
```

**Audit trail example:**
```
Override Applied:
├─ Reason: "Customer unable to upload - technical issue"
├─ Applied by: John (Closer)
├─ Date: 2026-07-28 14:30 UTC
└─ Audit Log: ✓ Recorded
```

---

## 📊 Database Schema

### New Table: `document_verifications`
```sql
id                UUID              -- Document record ID
sale_id           UUID              -- Which sale
contact_id        UUID              -- Which customer
country_code      TEXT              -- "US", "ES", "MX", etc.
document_type     TEXT              -- "passport", "dni", etc.
document_url      TEXT              -- Signed URL to file
status            TEXT              -- pending/verified/rejected
verified_at       TIMESTAMPTZ       -- When verified
verified_by       UUID              -- Who verified (admin)
rejection_reason  TEXT              -- Why rejected (if applicable)
created_at        TIMESTAMPTZ       -- When uploaded
```

### New Fields in `sales` Table
```sql
documents_verified              BOOLEAN       -- Documents OK?
documents_verified_at           TIMESTAMPTZ   -- When verified
documents_verified_by           UUID          -- Who verified
documents_verified_override     BOOLEAN       -- Override applied?
documents_override_reason       TEXT          -- Why override?
documents_override_by           UUID          -- Who overrode
documents_override_at           TIMESTAMPTZ   -- When overrode
```

---

## ⚙️ API Reference

### Upload Document
```
POST /api/evergreen/documents/verify
Content-Type: application/json

{
  "saleId": "uuid",
  "contactId": "uuid",
  "countryCode": "US",
  "documentType": "passport",
  "fileBase64": "iVBORw0KGg...",
  "fileName": "passport.jpg"
}

Response: 200
{
  "success": true,
  "document_id": "uuid",
  "message": "Document uploaded successfully"
}
```

### Apply Override
```
POST /api/evergreen/documents/override
Content-Type: application/json

{
  "saleId": "uuid",
  "reason": "Customer unable to upload - technical issues",
  "userId": "uuid"
}

Response: 200
{
  "success": true,
  "message": "Document verification overridden...",
  "sale_id": "uuid"
}
```

### Check Status
```
GET /api/evergreen/documents/state?saleId=uuid

Response: 200
{
  "documents_verified": true,
  "documents_verified_at": "2026-07-28T10:30:00Z",
  "documents_verified_by": { "full_name": "Maria" },
  "documents_verified_override": false,
  "documents_override_reason": null,
  "documents_override_by": null,
  "documents_override_at": null
}
```

---

## 🔐 Security & Compliance

✓ **Storage:** Private bucket + 10-year signed URLs
✓ **Access:** Role-based (admin/director/closer only)
✓ **Audit:** Every action logged (who, when, why)
✓ **Encryption:** Files at rest in Supabase (encrypted)
✓ **GDPR:** Can delete documents after verification period

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| "Storage bucket not found" | Create `documentos-verificacion` in Supabase Storage |
| Override button not showing | Check user role is admin/director/closer |
| Contract still blocks after override | Verify `documents_verified` or `documents_verified_override` is true in DB |
| Documents not uploading | Check bucket exists and file size < 10MB |

---

## 📞 Support

For questions:
- **Technical details:** See `DOCUMENT-VERIFICATION-IMPLEMENTATION.md`
- **Code examples:** See `DOCUMENT-VERIFICATION-USAGE-EXAMPLES.md`
- **Database:** Check `scripts/migration-v47-document-verification.sql`
- **UI:** Check `components/sales/DocumentVerificationSection.tsx`

---

## ✅ Final Checklist

Before going live:

- [ ] Migration v47 executed in Supabase
- [ ] Storage bucket `documentos-verificacion` created
- [ ] DocumentVerificationSection added to sales page
- [ ] Tested: Block without docs → ❌
- [ ] Tested: Allow with override → ✓
- [ ] Tested: Audit trail recorded → ✓
- [ ] Documented in team wiki/runbook
- [ ] Closed related issues/tickets

**Ready to ship!** 🚀
