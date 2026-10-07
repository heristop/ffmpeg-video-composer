// The second batch of sound-effect recipes (social and promo editing): claps, UI feedback, drops, builds and
// foley. Same rules as gen-sfx.ts: seeded lavfi sources only, every edge ramped so nothing clicks.
import { noise, strike, tone, type SfxRecipe } from './gen-sfx-sources.ts';

// An envelope burst for aevalsrc: silent before `on`, a 0.5 ms attack, then exponential decay at `decay`/s.
const burst = (on: number, decay: number, gain = 1): string =>
  `${gain}*gte(t,${on})*exp(-${decay}*(t-${on}))*min(1,(t-${on})*2000)`;

// A held note between `on` and `off` with `ramp`-second edges; `body` is a function of @, the note's phase.
const held = (on: number, off: number, freq: number, body: string, ramp = 0.01): string =>
  `between(t,${on},${off})*min(1,(t-${on})/${ramp})*min(1,(${off}-t)/${ramp})*` +
  `(${body.replaceAll('@', `2*PI*${freq}*(t-${on})`)})`;

export const PROMO_RECIPES: SfxRecipe[] = [
  {
    // Three palms smacking 10 ms apart (the flam that makes a clap sound like hands), then the main crack
    // ringing out in a small room: band-limited noise around 1.2 kHz plus an airy top.
    id: 'clap',
    graph:
      `${noise(0.5, 'white', 47, 0.9)}[n];` +
      tone(0.5, [burst(0, 260), burst(0.01, 260, 1.2), burst(0.021, 260, 1.3), burst(0.032, 24)].join('+')) +
      '[env];[n][env]amultiply,asplit[c1][c2];' +
      '[c1]bandpass=f=1150:t=q:w=1.1,volume=2.2[body];[c2]highpass=f=3200,lowpass=f=10000,volume=0.6[air];' +
      '[body][air]amix=inputs=2:normalize=0,highpass=f=350,' +
      'aecho=0.9:0.5:17|29|41:0.22|0.14|0.08,atrim=end=0.5,afade=t=out:st=0.38:d=0.12[a]',
  },
  {
    // A finger snap: a hard 2.4 kHz crack that dies in 30 ms, with a hint of the thumb's low knock.
    id: 'snap',
    graph:
      `${noise(0.2, 'white', 53, 0.9)}[n];${tone(0.2, burst(0, 110))}[env];` +
      '[n][env]amultiply,bandpass=f=2400:t=q:w=1.4,volume=2[crack];' +
      `${tone(0.2, `0.15*${strike(0, 420, 120, 'sin(F)')}`)}[knock];` +
      '[crack][knock]amix=inputs=2:normalize=0,aecho=0.9:0.4:13|23:0.15|0.08,atrim=end=0.2,afade=t=out:st=0.16:d=0.04[a]',
  },
  {
    // Three mallet notes up a C major triad (E5, G5, C6), the last one left to ring.
    id: 'success',
    graph:
      tone(
        1,
        '0.45*(' +
          [
            strike(0, 659.3, 9, 'sin(F)+0.25*sin(2*F)+0.06*sin(3*F)'),
            strike(0.09, 784, 9, 'sin(F)+0.25*sin(2*F)+0.06*sin(3*F)'),
            strike(0.18, 1046.5, 4.5, 'sin(F)+0.2*sin(2*F)+0.05*sin(3*F)'),
          ].join('+') +
          ')'
      ) + ',afade=t=out:st=0.8:d=0.2[a]',
  },
  {
    // Two soft, low, slightly detuned buzzes (the second a touch lower), muffled so it stays polite.
    id: 'error',
    graph:
      tone(
        0.45,
        '0.5*(' +
          held(0, 0.15, 165, 'tanh(2*sin(@))+0.6*tanh(2*sin(1.012*@))', 0.012) +
          '+' +
          held(0.21, 0.4, 147, 'tanh(2*sin(@))+0.6*tanh(2*sin(1.012*@))', 0.012) +
          ')'
      ) + ',lowpass=f=1100,highpass=f=90,afade=t=out:st=0.42:d=0.03[a]',
  },
  {
    // A slow airy pass: pink noise swelling and fading through a slow jet flanger, so the air seems to sweep
    // past.
    id: 'swoosh-long',
    graph:
      `${noise(1.2, 'pink', 59, 0.9)},highpass=f=500,lowpass=f=10000,` +
      'flanger=delay=1:depth=8:regen=65:width=85:speed=0.4:shape=sinusoidal,' +
      'afade=t=in:d=0.6:curve=qsin,afade=t=out:st=0.6:d=0.6:curve=qsin[a]',
  },
  {
    // An 808 sub drop: a saturated sine diving from 160 Hz to 38 Hz over a second and a half.
    id: 'sub-drop',
    graph:
      tone(1.5, 'tanh(1.8*sin(2*PI*(38*t+122*(1-exp(-3*t))/3)))*exp(-1.4*t)*min(1,t*300)') +
      ',lowpass=f=600,afade=t=out:st=1.2:d=0.3[a]',
  },
  {
    // A crash cymbal played backwards: bright metallic noise swelling to a hard stop at its end.
    id: 'reverse-cymbal',
    graph:
      `${noise(1.5, 'white', 71, 0.3)},highpass=f=3000,lowpass=f=14000,` +
      'equalizer=f=6500:t=q:w=2:g=6,equalizer=f=9800:t=q:w=3:g=4[shimmer];' +
      `${tone(1.5, '(t/1.5)^3.2')}[env];` +
      '[shimmer][env]amultiply,afade=t=out:st=1.485:d=0.015[a]',
  },
  {
    // A water drop: a sine whose pitch leaps from 450 Hz to 1.5 kHz in a few milliseconds ("bloop").
    id: 'water-drop',
    graph:
      tone(0.3, 'sin(2*PI*(1500*t-1050*(1-exp(-70*t))/70))*exp(-28*t)*min(1,t*1500)') +
      ',highpass=f=200,afade=t=out:st=0.24:d=0.06[a]',
  },
  {
    // A slide whistle up: a breathy tone gliding from 500 Hz to 1.9 kHz with a little vibrato.
    id: 'whistle-up',
    graph:
      tone(
        0.7,
        '(sin(2*PI*(500*t+1400*t*t*t/(3*0.49))+4*sin(2*PI*6*t))+0.08*sin(4*PI*(500*t+1400*t*t*t/(3*0.49))))*' +
          'min(1,t/0.03)*min(1,(0.7-t)/0.06)'
      ) +
      `[pipe];${noise(0.7, 'pink', 73, 0.12)},bandpass=f=1800:t=q:w=1,afade=t=in:d=0.05,afade=t=out:st=0.6:d=0.1[breath];` +
      '[pipe][breath]amix=inputs=2:normalize=0,lowpass=f=7000[a]',
  },
  {
    // An autofocus: a short servo whirr hunting in pitch, then the two-beep focus lock.
    id: 'camera-focus',
    graph:
      tone(
        0.62,
        `0.45*${held(0, 0.3, 1, 'tanh(2*sin(2*PI*(480*t+0.8*sin(2*PI*9*t))))*(0.75+0.25*sin(2*PI*31*t))', 0.03)}` +
          `+0.5*${held(0.38, 0.43, 2900, 'sin(@)', 0.003)}+0.5*${held(0.48, 0.53, 2900, 'sin(@)', 0.003)}`
      ) + ',highpass=f=150,lowpass=f=6000,afade=t=out:st=0.58:d=0.04[a]',
  },
  {
    // A page flip: paper hiss that crackles (a hash of 2.5 ms slices sets its grain) as it swells and
    // falls, then a soft low flap as the page lands.
    id: 'paper',
    graph:
      `${noise(0.45, 'white', 79, 0.9)},highpass=f=1200,lowpass=f=9000[hiss];` +
      tone(
        0.45,
        'st(0,floor(t*400));st(1,sin(ld(0)*12.9898)*43758.5453);st(1,ld(1)-floor(ld(1)));' +
          '(0.45+0.55*ld(1))*abs(sin(PI*min(1,t/0.36)))^1.5*lt(t,0.36)'
      ) +
      '[grain];[hiss][grain]amultiply,lowpass=f=7000[rustle];' +
      `${noise(0.45, 'brown', 83, 0.8)}[low];${tone(0.45, burst(0.3, 40))}[flapenv];` +
      '[low][flapenv]amultiply,lowpass=f=500,volume=0.5[flap];' +
      '[rustle][flap]amix=inputs=2:normalize=0,afade=t=out:st=0.4:d=0.05[a]',
  },
  {
    // A short fanfare: a G4 pickup, then a held C major chord (C5, E5, G5) in a bright brassy timbre.
    id: 'tada',
    graph:
      tone(
        1.3,
        '0.3*(' +
          held(0, 0.11, 392, 'tanh(1.6*sin(@))+0.3*sin(2*@)', 0.012) +
          `+exp(-1.2*max(0,t-0.15))*(${[523.25, 659.25, 784]
            .map((f) => held(0.15, 1.28, f, 'tanh(1.6*sin(@+0.6*sin(2*PI*5.5*t)))+0.3*sin(2*@)', 0.015))
            .join('+')}))`
      ) + ',lowpass=f=3800,highpass=f=120,aecho=0.9:0.35:37|59:0.18|0.1,atrim=end=1.3,afade=t=out:st=1.1:d=0.2[a]',
  },
];
