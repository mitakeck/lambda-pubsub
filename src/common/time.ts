const timestamp = (): number => (new Date()).getTime()/1000;

const DURATION_MINUTE: number = 60;
const DURATION_HOUR: number = DURATION_MINUTE * 60;
const DURATION_DAY: number = DURATION_HOUR * 24;
const DURATION_MONTH: number = DURATION_DAY * 30.5;
const DURATION_YEAR: number = DURATION_MONTH * 12;

export {
  timestamp,

  DURATION_MINUTE,
  DURATION_HOUR,
  DURATION_DAY,
  DURATION_MONTH,
  DURATION_YEAR,
};
