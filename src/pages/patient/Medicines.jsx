import CommonClinical from '../../components/CommonClinical';
import { getSession } from '../../utils/session';
export default function Medicines() { return <CommonClinical healthId={getSession().healthId} view="medicines" />; }
