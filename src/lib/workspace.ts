import type {Account} from './types'

export function apiBalances(accounts: Account[]): {currency:string;balance:number;count:number}[] {
  const totals = new Map<string, {currency:string;balance:number;count:number}>()
  for (const account of accounts) {
    if (account.type !== 'api' || account.currency === 'percent' || account.balance == null || !Number.isFinite(account.balance) || account.balance < 0) continue
    const current = totals.get(account.currency) ?? {currency:account.currency,balance:0,count:0}
    current.balance += account.balance
    current.count++
    totals.set(account.currency, current)
  }
  return [...totals.values()]
}
