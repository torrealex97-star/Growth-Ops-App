# Document Verification System - Implementation Guide

## Overview

This system ensures that customers provide proper identification documents before contracts are sent, especially for sales in the USA and other countries with strict regulations. It includes a **firewall override** allowing closers and admins to proceed in exceptional cases (technical issues, customer unavailability).

**Flow:**
```
Sale Created → [Document Verification Required] → Contract Sending → Signature
```

---

## Components Implemented

### 1. Database Migration (v47)

**File:** `scripts/migration-v47-document-verification.sql`

Creates:
- `document_verifications` table: Records all uploaded documents
- New fields in `sales` table:
  - `documents_verified` (boolean): Whether verification is complete
  - `documents_verified_at` (timestamp): When verified
  - `documents_verified_by` (UUID): Who verified it
  - `documents_verified_override` (boolean): Whether firewall was used
  - `documents_override_reason` (text): Why override was needed
  - `documents_override_by` (UUID): Who applied override
  - `documents_override_at` (timestamp): When override applied

**Run the migration:**
```bash
# Copy the migration file to Supabase SQL editor or:
psql -h <supabase-host> -U postgres -d postgres < scripts/migration-v47-document-verification.sql
```

### 2. Document Requirements Configuration

**File:** `lib/contracts/document-requirements.ts`

Defines document types required by country:
- **Spain (ES):** DNI, NIE, Passport
- **USA (US):** Passport, Driver's License, State ID
- **Mexico (MX):** Passport, IFE, Cédula
- **Argentina (AR):** Cédula, Passport
- **Colombia (CO):** Cédula, Passport
- **Peru (PE):** DNI, Passport
- **Chile (CL):** RUT/Cédula, Passport
- **Default:** Passport (for unlisted countries)

Includes helper functions:
```typescript
getDocumentRequirement(country?: string | null)  // Get requirements by country
getCountryCode(countryName?: string | null)      // Normalize country name to ISO code
```

### 3. Document Upload Endpoint

**File:** `app/api/evergreen/documents/verify/route.ts`

**Endpoint:** `POST /api/evergreen/documents/verify`

**Request:**
```json
{
  "saleId": "uuid",
  "contactId": "uuid",
  "countryCode": "US",
  "documentType": "passport",
  "fileBase64": "base64-encoded-file",
  "fileName": "passport.jpg"
}
```

**Process:**
1. Validates sale and contact exist
2. Converts base64 file to buffer
3. Uploads to Supabase Storage bucket: `documentos-verificacion/{saleId}/{contactId}/{timestamp}-{fileName}`
4. Generates 10-year signed URL
5. Creates record in `document_verifications` table (status: "pending")

**Response:**
```json
{
  "success": true,
  "document_id": "uuid",
  "message": "Document uploaded successfully. Awaiting verification."
}
```

### 4. Firewall Override Endpoint

**File:** `app/api/evergreen/documents/override/route.ts`

**Endpoint:** `POST /api/evergreen/documents/override`

**Access:** Admin, Director, Closer roles only

**Request:**
```json
{
  "saleId": "uuid",
  "reason": "Customer unable to upload due to technical issues",
  "userId": "uuid"
}
```

**Process:**
1. Validates user role (admin/director/closer)
2. Marks sale as `documents_verified_override = true`
3. Sets `documents_verified = true` to allow contract sending
4. Records who, when, and why (audit trail)
5. Logs action in audit_logs table

**Response:**
```json
{
  "success": true,
  "message": "Document verification overridden...",
  "sale_id": "uuid"
}
```

### 5. Document State Endpoint

**File:** `app/api/evergreen/documents/state/route.ts`

**Endpoint:** `GET /api/evergreen/documents/state?saleId={uuid}`

Returns current document verification state with user details:
```json
{
  "documents_verified": true,
  "documents_verified_at": "2026-07-28T10:30:00Z",
  "documents_verified_by": { "full_name": "John Doe" },
  "documents_verified_override": false,
  "documents_override_reason": null,
  "documents_override_by": null,
  "documents_override_at": null
}
```

### 6. Contract Sending Protection

**File:** `app/api/evergreen/contracts/student/route.ts` (modified)

**Added validation** before generating contracts:

```typescript
const docsVerified = (sale.documents_verified === true) || (sale.documents_verified_override === true)
if (!docsVerified) {
  return NextResponse.json(
    {
      error: 'Document verification required',
      message: 'This sale requires document verification before sending the contract...'
    },
    { status: 403 }
  )
}
```

Blocks contract sending if:
- ✗ `documents_verified = false` AND `documents_verified_override = false`

Allows contract sending if:
- ✓ `documents_verified = true` (normal verification completed)
- ✓ `documents_verified_override = true` (firewall override applied)

### 7. UI Component

**File:** `components/sales/DocumentVerificationSection.tsx`

React component showing:
- ✅ Green indicator when verified
- ⚠️ Amber indicator when pending
- Verification timestamps and who verified
- **Firewall Override button** (visible to admin/director/closer only)
- Modal to enter override reason with audit warning

**Integration:** Add to sales detail page:
```tsx
<DocumentVerificationSection
  saleId={saleId}
  contactCountry={contact.country}
  contactEmail={contact.email}
  userRole={userRole}
/>
```

---

## Implementation Checklist

- [ ] **1. Run migration**
  ```bash
  # Execute migration-v47-document-verification.sql in Supabase SQL editor
  ```

- [ ] **2. Verify files created**
  - ✓ `scripts/migration-v47-document-verification.sql`
  - ✓ `lib/contracts/document-requirements.ts`
  - ✓ `app/api/evergreen/documents/verify/route.ts`
  - ✓ `app/api/evergreen/documents/override/route.ts`
  - ✓ `app/api/evergreen/documents/state/route.ts`
  - ✓ `components/sales/DocumentVerificationSection.tsx`

- [ ] **3. Update sales detail page** to include `<DocumentVerificationSection />`

- [ ] **4. Create Supabase Storage bucket** named `documentos-verificacion`
  ```
  Name: documentos-verificacion
  Public: No (documents are private, served via signed URLs)
  File size limit: 10 MB
  ```

- [ ] **5. Test the flow**
  - Create a sale from USA
  - Verify "Document Verification Required" blocks contract sending
  - Upload document via verification endpoint
  - Test override button with different roles

- [ ] **6. Add environment variables** (if needed)
  - `NEXT_PUBLIC_SUPABASE_URL` (already exists)
  - `SUPABASE_SERVICE_ROLE_KEY` (already exists)

---

## Usage Scenarios

### Scenario 1: Normal Flow (Document Verified)
1. Sale created for USA customer
2. System marks `documents_verified = false`
3. Closer asks customer to upload ID (via email/link)
4. Customer uploads document → stored in `document_verifications`
5. Admin verifies document → marks `documents_verified = true`
6. Closer can now send contract ✓

### Scenario 2: Firewall Override (Technical Issues)
1. Sale created for USA customer
2. Customer cannot upload document (app crashes, file too large, etc.)
3. Closer clicks **"Apply Override"** button
4. Modal appears asking for reason: "Customer unable to upload - technical issues"
5. System sets `documents_verified_override = true`
6. Audit log records: who, when, why
7. Closer can now send contract ✓
8. **Later:** Customer can still upload document manually for records

### Scenario 3: Firewall Override (Urgent Case)
1. Sale created, payment received, onboarding pending
2. Customer is ready to start but documents still being prepared
3. Closer applies override with reason: "Urgent - customer ready to start, documents in preparation"
4. Contract sent immediately
5. Customer onboards
6. Documents uploaded within 48 hours ✓

---

## Audit Trail

All document actions are logged:

**Override actions** → recorded in `sales` table:
- `documents_override_by` (user ID)
- `documents_override_reason` (text)
- `documents_override_at` (timestamp)

**Verification actions** → recorded in `document_verifications` table:
- `verified_by` (user ID)
- `verified_at` (timestamp)
- `status` (pending/verified/rejected)

**Additional audit** (optional):
- Create `audit_logs` entry with action: `document_verification_override`

---

## Security Considerations

1. **Storage Privacy:** Documents stored in private bucket with signed URLs (10-year validity)
2. **Access Control:** Only admin/director can verify documents; only admin/director/closer can override
3. **Audit Trail:** All overrides logged with user, reason, and timestamp
4. **Rate Limiting:** Consider adding rate limits to prevent abuse
5. **File Validation:** Implement file type/size validation in upload endpoint (currently basic)

---

## Future Enhancements

1. **Automated OCR Verification:** Extract info from document automatically (AWS Textract, Google Vision)
2. **Liveness Check:** Verify document authenticity with photo comparison
3. **Third-party Verification:** Integrate with IDology, Jumio, or similar services
4. **Email Notification:** Send verification link to customer automatically
5. **Webhook Callback:** Notify external systems when verification completes
6. **Dashboard:** Admin panel to review pending documents and override history
7. **Country-specific Rules:** Different requirements per country (already structure-ready)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Storage bucket not found | Create `documentos-verificacion` bucket in Supabase Storage |
| Override button doesn't appear | Check user role in database; must be admin/director/closer |
| Contract still blocks | Verify `documents_verified` or `documents_verified_override` is true |
| Signed URL expires | URLs are 10 years; regenerate if needed via `createSignedUrl()` |

---

## Contact & Support

For questions about this implementation, refer to:
- Document requirements: `lib/contracts/document-requirements.ts`
- Database schema: `scripts/migration-v47-document-verification.sql`
- API endpoints: `/app/api/evergreen/documents/`
