import CommonClinical from '../../components/CommonClinical';
import { getSession } from '../../utils/session';
export default function Timeline() { return <CommonClinical healthId={getSession().healthId} view="timeline" />; }
