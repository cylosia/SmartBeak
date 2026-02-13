
import { PublicShell } from '../components/PublicShell';
import { useTranslation } from '../lib/i18n';

export default function Pricing() {
  const { t, formatCurrency } = useTranslation();
  return (
  <PublicShell>
    <h1>{t('pricing.title')}</h1>

    <h2>{t('pricing.soloTitle')}</h2>
    <p>{t('pricing.soloDescription', { price: formatCurrency(49) })}</p>
    <a href='/checkout?plan=solo'>{t('pricing.subscribe')}</a>

    <h2>{t('pricing.portfolioTitle')}</h2>
    <p>{t('pricing.portfolioDescription', { price: formatCurrency(199) })}</p>
    <a href='/checkout?plan=portfolio'>{t('pricing.subscribe')}</a>

    <h2>{t('pricing.enterpriseTitle')}</h2>
    <p>{t('pricing.enterpriseDescription')}</p>
    <a href='/contact'>{t('pricing.contactSales')}</a>
  </PublicShell>
  );
}
