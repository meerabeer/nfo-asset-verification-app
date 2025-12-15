export type CategoryType = 'RAN-Active' | 'RAN-Passive' | 'MW-Active' | 'MW-Passive' | 'Enclosure';

export interface Site {
  id: string;
  site_name: string;
  site_code: string;
  location?: string;
}

export interface Asset {
  id: string;
  site_id: string;
  category: CategoryType;
  serial_number?: string;
  tag_number?: string;
  status?: string;
  remarks?: string;
  name?: string;
  model?: string;
}

export interface AssetPhoto {
  id: string;
  asset_id: string;
  photo_type: 'serial' | 'tag';
  storage_path: string;
  public_url: string;
  created_at: string;
}
