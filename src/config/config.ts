import { DURATION_HOUR, DURATION_MINUTE, DURATION_MONTH } from "../common/time";

export default {
  connectionTtl: DURATION_HOUR * 2 + DURATION_MINUTE,
  messageTtl: DURATION_MONTH * 2,
}
