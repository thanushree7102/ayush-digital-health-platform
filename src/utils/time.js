import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// Backend stores UTC; always display IST (NFR-DAT-03)
export const formatIST = (iso) =>
  iso ? dayjs.utc(iso).tz('Asia/Kolkata').format('DD MMM YYYY, hh:mm A') + ' IST' : '';
