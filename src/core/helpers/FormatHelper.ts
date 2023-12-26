export const fancyTimeFormat = (
  duration: number,
  withMilliseconds: boolean = false,
  withHours: boolean = false
): string => {
  let hours: number | string = Math.floor(duration / 3600000);
  let minutes: number | string = Math.floor((duration - hours * 3600000) / 60000);
  let seconds: number | string;

  if (duration === 0) {
    return withHours ? '00:00:00' : '00:00';
  }

  if (withMilliseconds) {
    seconds = parseFloat((duration / 1000).toFixed(2)) % 60;
  } else {
    seconds = Math.floor((duration - hours * 3600000 - minutes * 60000) / 1000);
  }

  hours = hours < 10 ? `0${hours}` : hours.toString();
  minutes = minutes < 10 ? `0${minutes}` : minutes.toString();
  seconds = seconds < 10 ? `0${seconds}` : seconds.toString();

  if (withHours) {
    return `${hours}:${minutes}:${seconds}`;
  }

  return `${minutes}:${seconds}`;
};
