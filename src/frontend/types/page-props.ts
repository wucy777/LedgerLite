import type { Catalog, CryptoState, Entry, InitResult } from '@shared/types';

export interface LedgerPageProps {
  month: string;
  revision: number;
  catalog: Catalog;
  onMonthChange: (month: string) => void;
  onAdd: () => void;
  onEdit: (entry: Entry) => void;
}

export interface StatsPageProps {
  month: string;
  revision: number;
  onMonthChange: (month: string) => void;
}

export interface SettingsPageProps {
  version: string;
  crypto: CryptoState;
  catalog: Catalog;
  onCatalogChange: (catalog: Catalog) => void;
  onSessionChange: (session: InitResult) => void;
  onDataChanged: () => void;
  onLock: () => Promise<void>;
}

export interface EntrySheetProps {
  entry: Entry | null;
  catalog: Catalog;
  onClose: () => void;
  onSaved: (entry: Entry) => void;
  onDeleted: (entry: Entry) => void;
}
