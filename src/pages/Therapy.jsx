import FormPage from '../components/FormPage';
import usePrefill from '../hooks/usePrefill';
import { THERAPY_OPTIONS } from '../constants/options';

const fields = [
  { name: 'therapies', label: 'Panchakarma / other therapy', type: 'multiselect', options: THERAPY_OPTIONS, required: true },
  { name: 'therapyNotes', label: 'Therapy details (duration, sessions)', type: 'textarea' },
  { name: 'dietAdvice', label: 'Diet advice (Pathya-Apathya)', type: 'textarea', required: true },
  { name: 'lifestyleAdvice', label: 'Lifestyle advice', type: 'textarea', required: true },
];

export default function Therapy() {
  return <FormPage title="Therapy, Diet & Lifestyle Advice" endpoint="therapy" fields={fields} prefill={usePrefill('therapy')} />;
}
