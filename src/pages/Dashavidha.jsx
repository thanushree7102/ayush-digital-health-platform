import FormPage from '../components/FormPage';
import { SARA_OPTIONS } from '../constants/options';

const fields = [
  { name: 'prakriti', label: 'Prakriti', required: true },
  { name: 'vikriti', label: 'Vikriti', required: true },
  { name: 'sara', label: 'Sara (tissue quality)', type: 'select', options: SARA_OPTIONS, required: true },
  { name: 'samhanana', label: 'Samhanana (body compactness)', required: true },
  { name: 'pramana', label: 'Pramana (body measurements)', required: true },
  { name: 'satmya', label: 'Satmya (suitability / habituation)', required: true },
  { name: 'sattva', label: 'Sattva (mental strength)', required: true },
  { name: 'aharaShakti', label: 'Ahara Shakti (digestive & intake capacity)', required: true },
  { name: 'vyayamaShakti', label: 'Vyayama Shakti (exercise capacity)', required: true },
  { name: 'vaya', label: 'Vaya (age group)', required: true },
  { name: 'remarks', label: 'Remarks', type: 'textarea' },
];

export default function Dashavidha() {
  return <FormPage title="Dashavidha Pariksha" endpoint="dashavidha-pariksha" fields={fields} />;
}
