import RoleRegister from '../../components/RoleRegister';
import { ADMIN_TYPES } from '../../constants/options';

const fields = [
  { name: 'name', label: 'Full name', required: true },
  { name: 'adminType', label: 'Role', type: 'select', options: ADMIN_TYPES, required: true },
  { name: 'designation', label: 'Designation', required: true },
  { name: 'department', label: 'Department / organisation', required: true },
  { name: 'email', label: 'Official email', type: 'email', required: true, pattern: /^\S+@\S+\.\S+$/, patternMsg: 'Enter your official email' },
  { name: 'mobile', label: 'Mobile number', digits: 10, required: true, pattern: /^[6-9]\d{9}$/, patternMsg: 'Enter a valid 10-digit mobile number' },
  { name: 'inviteCode', label: 'Invite code (demo: AYUSH-ADMIN-2026)', required: true },
];

export default function Admin() {
  return (
    <RoleRegister
      role="admin"
      aadhaarFill={['name', 'email']}
      json
      title="Admin / auditor registration"
      intro="Staff accounts need an invite code. What you can do depends on your role: verification admins decide registrations, auditors only view the audit log."
      endpoint="/auth/register/admin"
      fields={fields}
      steps={{ declaration: 'I will keep patient and audit data confidential.', submit: 'Create staff account' }}
    />
  );
}
