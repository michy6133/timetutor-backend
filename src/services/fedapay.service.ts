import { env } from '../config/env';

interface InitTransactionResult {
  transactionId: string;
  publicKey: string;
  amount: number;
  description: string;
}

export async function initFedaPayTransaction(opts: {
  amount: number;
  description: string;
  customerEmail: string;
  customerName: string;
  callbackUrl: string;
}): Promise<InitTransactionResult> {
  if (!env.FEDAPAY_SECRET_KEY) {
    return {
      transactionId: `mock_${Date.now()}`,
      publicKey: env.FEDAPAY_PUBLIC_KEY || 'mock_pk',
      amount: opts.amount,
      description: opts.description,
    };
  }

  const baseUrl = env.FEDAPAY_ENV === 'live'
    ? 'https://api.fedapay.com/v1'
    : 'https://sandbox-api.fedapay.com/v1';

  const res = await fetch(`${baseUrl}/transactions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.FEDAPAY_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: opts.description,
      amount: opts.amount,
      currency: { iso: 'XOF' },
      callback_url: opts.callbackUrl,
      customer: { email: opts.customerEmail, firstname: opts.customerName },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`FedaPay error: ${err}`);
  }

  const data = await res.json() as { v1_transaction: { id: number } };
  return {
    transactionId: String(data.v1_transaction.id),
    publicKey: env.FEDAPAY_PUBLIC_KEY,
    amount: opts.amount,
    description: opts.description,
  };
}

export async function verifyFedaPayTransaction(transactionId: string): Promise<{ status: string; amount: number }> {
  if (!env.FEDAPAY_SECRET_KEY || transactionId.startsWith('mock_')) {
    return { status: 'approved', amount: 0 };
  }

  const baseUrl = env.FEDAPAY_ENV === 'live'
    ? 'https://api.fedapay.com/v1'
    : 'https://sandbox-api.fedapay.com/v1';

  const res = await fetch(`${baseUrl}/transactions/${transactionId}`, {
    headers: { 'Authorization': `Bearer ${env.FEDAPAY_SECRET_KEY}` },
  });

  if (!res.ok) throw new Error('FedaPay verification failed');
  const data = await res.json() as { v1_transaction: { status: string; amount: number } };
  return {
    status: data.v1_transaction.status,
    amount: data.v1_transaction.amount,
  };
}
