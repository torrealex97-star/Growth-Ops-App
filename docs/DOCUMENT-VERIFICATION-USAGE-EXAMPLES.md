# Document Verification - Usage Examples

## For Developers: Integrating Document Upload

### Example 1: Upload Document from React Component

```typescript
import { useState } from 'react'
import { getCountryCode, getDocumentRequirement } from '@/lib/contracts/document-requirements'

function DocumentUploadForm({ saleId, contactId, contactCountry }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const countryCode = getCountryCode(contactCountry)
  const requirement = getDocumentRequirement(contactCountry)

  const handleUpload = async () => {
    if (!file) return

    setUploading(true)
    try {
      // Convert file to base64
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = async () => {
        const base64 = reader.result?.toString().split(',')[1]

        const res = await fetch('/api/evergreen/documents/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleId,
            contactId,
            countryCode,
            documentType: 'passport', // User selected in UI
            fileBase64: base64,
            fileName: file.name
          })
        })

        const data = await res.json()
        if (res.ok) {
          toast.success('Document uploaded successfully')
          setFile(null)
        } else {
          toast.error(data.error)
        }
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Required for {contactCountry}: {requirement.label}
      </p>
      <p className="text-xs text-muted-foreground">{requirement.instructions}</p>

      <input
        type="file"
        accept="image/*,.pdf"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        disabled={uploading}
      />

      <button
        onClick={handleUpload}
        disabled={!file || uploading}
      >
        {uploading ? 'Uploading...' : 'Upload Document'}
      </button>
    </div>
  )
}
```

### Example 2: Check Verification Status

```typescript
async function checkDocumentStatus(saleId: string) {
  const res = await fetch(`/api/evergreen/documents/state?saleId=${saleId}`)
  const state = await res.json()

  if (state.documents_verified) {
    console.log('✓ Documents verified')
    console.log(`Verified at: ${state.documents_verified_at}`)
    console.log(`Verified by: ${state.documents_verified_by?.full_name}`)
  } else if (state.documents_verified_override) {
    console.log('⚡ Override applied')
    console.log(`Reason: ${state.documents_override_reason}`)
    console.log(`Applied by: ${state.documents_override_by?.full_name}`)
  } else {
    console.log('⏳ Pending verification')
  }
}
```

### Example 3: Apply Firewall Override (Closer/Admin)

```typescript
async function applyDocumentOverride(
  saleId: string,
  userId: string,
  reason: string
) {
  const res = await fetch('/api/evergreen/documents/override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      saleId,
      userId,
      reason
    })
  })

  if (res.ok) {
    const data = await res.json()
    console.log('✓ Override applied:', data.message)
    // Can now send contract
    return true
  } else {
    const err = await res.json()
    console.error('✗ Override failed:', err.error)
    return false
  }
}

// Usage:
const overrideApplied = await applyDocumentOverride(
  'sale-uuid',
  'closer-uuid',
  'Customer unable to upload - technical issues with app'
)

if (overrideApplied) {
  // Send contract via /api/evergreen/contracts/student
}
```

---

## For Admin: Verifying Documents Manually

### Example 1: Review Pending Documents

```sql
-- Find all pending verifications
SELECT
  dv.id,
  dv.sale_id,
  dv.contact_id,
  dv.country_code,
  dv.document_type,
  dv.document_url,
  dv.status,
  dv.created_at,
  c.full_name,
  c.email
FROM document_verifications dv
JOIN contacts c ON dv.contact_id = c.id
WHERE dv.status = 'pending'
ORDER BY dv.created_at ASC;
```

### Example 2: Mark Document as Verified

```sql
-- Verify a document (by admin)
UPDATE document_verifications
SET
  status = 'verified',
  verified_at = NOW(),
  verified_by = 'admin-user-uuid'
WHERE id = 'document-verification-id';

-- Mark sale as verified
UPDATE sales
SET
  documents_verified = true,
  documents_verified_at = NOW(),
  documents_verified_by = 'admin-user-uuid'
WHERE id = (
  SELECT sale_id FROM document_verifications
  WHERE id = 'document-verification-id'
);
```

### Example 3: Reject Document & Request Reupload

```sql
-- Reject a document
UPDATE document_verifications
SET
  status = 'rejected',
  rejection_reason = 'Document text not legible - please provide high-quality photo',
  verified_at = NOW(),
  verified_by = 'admin-user-uuid'
WHERE id = 'document-verification-id';

-- Contact customer to re-upload
-- Sale remains documents_verified = false
-- Contract sending remains blocked
```

---

## For Customers: Document Upload Flow (Email Link)

### Example: Email Link Pattern

Customer receives email:

```
Subject: Complete Your Enrollment - Document Verification Required

Hi María,

To finalize your enrollment in the IA WINNERS program, please provide a photo of your identification document.

📸 Upload Your Document: https://app.iawinners.com/documentos/verify/abc123xyz789

Required document:
• Passport
• Driver's License
• Government-issued ID

⏱️ Expected time: 2-3 minutes
✓ Secure upload (encrypted, deleted after verification)

Questions? Reply to this email.

Best regards,
IA WINNERS Team
```

### Example: Document Upload Page

```typescript
// pages/documentos/verify/[token].tsx
export default function DocumentVerifyPage({ token }: { token: string }) {
  const [saleId, setSaleId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [country, setCountry] = useState<string | null>(null)

  useEffect(() => {
    // Decode token to get sale/contact IDs
    validateToken(token).then(data => {
      setSaleId(data.saleId)
      setContactId(data.contactId)
      setCountry(data.country)
    })
  }, [token])

  return (
    <DocumentUploadForm
      saleId={saleId}
      contactId={contactId}
      contactCountry={country}
    />
  )
}
```

---

## Real-World Scenarios

### Scenario A: USA Customer - Normal Flow

1. **Sale created:** USA customer, payment received
   - `documents_verified = false`
   - Contract sending blocked ❌

2. **Email sent to customer:** "Upload your passport"
   - Customer receives link to upload

3. **Customer uploads:** High-quality passport photo
   - Document stored in `documentos-verificacion/sale-id/contact-id/timestamp-passport.jpg`
   - Record created in `document_verifications` table (status: pending)
   - Awaiting admin verification

4. **Admin reviews:** Opens document, verifies it's valid
   - Clicks "Verify" button
   - Updates `document_verifications` set status = 'verified'
   - Updates `sales` set `documents_verified = true`

5. **Closer sends contract:** Now allowed ✓
   - `POST /api/evergreen/contracts/student?saleId=...`
   - Succeeds because `documents_verified = true`
   - Customer receives signature link

6. **Customer signs & onboarding begins** ✓

---

### Scenario B: Spain Customer - Firewall Override

1. **Sale created:** Spain customer, payment received
   - `documents_verified = false`
   - Contract sending blocked ❌

2. **Email sent:** "Upload your DNI or Passport"
   - No response for 2 hours

3. **Closer needs to proceed:** Customer ready for onboarding call
   - Clicks **"Apply Override"** button
   - Modal: "Reason: Customer confirms documents will be provided during onboarding call"
   - Applies override

4. **Override recorded:**
   ```sql
   -- Updated in sales table:
   documents_verified_override = true
   documents_override_reason = "Customer confirms docs will be provided during onboarding call"
   documents_override_by = "closer-uuid"
   documents_override_at = "2026-07-28T14:30:00Z"
   documents_verified = true  -- Set true to allow contract
   documents_verified_at = "2026-07-28T14:30:00Z"
   documents_verified_by = "closer-uuid"
   ```

5. **Closer sends contract:** Now allowed ✓
   - Override logged for audit

6. **During onboarding call:** Customer provides document
   - Can be uploaded manually by admin
   - `document_verifications` table updated

7. **Everything documented:**
   - Original override + reason visible in admin panel
   - Document eventually provided
   - Audit trail complete ✓

---

### Scenario C: Mexico Customer - Technical Issues Override

1. **Sale created:** Mexico customer
   - Payment received, contract ready to send
   - `documents_verified = false`

2. **Customer tries to upload:**
   - App crashes (bug in file upload)
   - Gets "File too large" error
   - Tries 3 times, gives up

3. **Customer messages closer:** "I can't upload the file"
   - Closer investigates → confirms app has bug
   - Temporary fix: override

4. **Closer applies override:**
   - Reason: "App file upload bug (ticket #1234) - customer able, app not"
   - System notes override is temporary

5. **Contract sent, onboarding begins** ✓

6. **Dev team fixes bug:**
   - Customer can now upload documents manually
   - Document verified by admin

7. **Audit trail shows:**
   - Why override was needed (technical issue)
   - Date and who applied it
   - Later verification when customer uploads ✓

---

## Testing the Implementation

### Test Case 1: Block Contract Without Documents

```bash
# Create sale (documents_verified = false)
curl -X POST https://app.iawinners.com/api/evergreen/contracts/student \
  -H "Content-Type: application/json" \
  -d '{"saleId": "test-sale-id", "send": true}'

# Expected response:
# ❌ 403 Document verification required
```

### Test Case 2: Allow Contract After Document Verification

```bash
# 1. Upload document
curl -X POST https://app.iawinners.com/api/evergreen/documents/verify \
  -H "Content-Type: application/json" \
  -d '{
    "saleId": "test-sale-id",
    "contactId": "contact-id",
    "countryCode": "US",
    "documentType": "passport",
    "fileBase64": "iVBORw0KGgo...",
    "fileName": "passport.jpg"
  }'

# 2. Verify document (admin action, direct DB or admin panel)
# UPDATE document_verifications SET status = 'verified' WHERE ...

# 3. Mark sale as verified (admin action)
# UPDATE sales SET documents_verified = true WHERE id = 'test-sale-id'

# 4. Send contract (now allowed)
curl -X POST https://app.iawinners.com/api/evergreen/contracts/student \
  -H "Content-Type: application/json" \
  -d '{"saleId": "test-sale-id", "send": true}'

# Expected response:
# ✓ 200 OK (contract generated and sent)
```

### Test Case 3: Override Permission Check

```bash
# Try override as regular user (should fail)
curl -X POST https://app.iawinners.com/api/evergreen/documents/override \
  -H "Content-Type: application/json" \
  -d '{
    "saleId": "test-sale-id",
    "reason": "test override",
    "userId": "regular-user-id"
  }'

# Expected response:
# ❌ 403 Unauthorized: insufficient permissions

# Try as admin (should succeed)
# Same curl but with admin userId
# ✓ 200 OK
```

---

## Monitoring & Alerts

### Queries for Monitoring

```sql
-- Overrides applied in last 24 hours
SELECT COUNT(*) as overrides_today
FROM sales
WHERE documents_verified_override = true
AND documents_override_at > NOW() - INTERVAL '1 day';

-- Pending document verifications
SELECT COUNT(*) as pending_docs
FROM document_verifications
WHERE status = 'pending'
AND created_at > NOW() - INTERVAL '3 days';

-- Which users applied most overrides
SELECT documents_override_by, COUNT(*) as override_count
FROM sales
WHERE documents_verified_override = true
GROUP BY documents_override_by
ORDER BY override_count DESC;
```

### Alert Conditions

- **High override rate:** >20% of sales using override
- **Stale documents:** Documents pending >7 days
- **Unusual activity:** Same user applying >10 overrides in 1 hour
