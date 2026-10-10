import { useMediaQuery } from '@/hooks/use-media-query';
import { PORTRAIT_PROMO_QUERY, promoOrientation, type PromoOrientation } from './promo-orientation.logic';

/** The cut of the landing's promo videos this screen gets, live: turning the phone swaps it. */
export const usePromoOrientation = (): PromoOrientation => promoOrientation(useMediaQuery(PORTRAIT_PROMO_QUERY));
