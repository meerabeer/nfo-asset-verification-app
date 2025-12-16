import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { RealtimeChannel } from '@supabase/supabase-js';
import '../styles/SiteSearch.css';

// Tab to table mapping
const TAB_TABLE_MAP: Record<string, string> = {
  'Enclosure': 'enclosure_assets',
  'RAN-Active': 'ran_active_assets',
  'RAN-Passive': 'ran_passive_assets',
  'MW-Active': 'mw_active_assets',
  'MW-Passive': 'mw_passive_assets',
};

const TABS = ['Enclosure', 'RAN-Active', 'RAN-Passive', 'MW-Active', 'MW-Passive'];

// Asset row interface
interface AssetRow {
  id: string;
  site_id: string;
  date_text?: string;
  equipment_type?: string;
  product_name?: string;
  product_number?: string;
  serial?: string;
  tag?: string;
  status?: string;
  remarks?: string;
  [key: string]: unknown;
}

// Photo record interface (matches existing public.asset_photos schema)
interface AssetPhoto {
  id: string;
  asset_id: string;            // UUID
  asset_table: string;         // text
  photo_type: 'serial' | 'tag';
  storage_path: string;
  url?: string;                // optional
  taken_at?: string;
  taken_by?: string;           // UUID
  created_at?: string;
  // Runtime field for signed URL
  signedUrl?: string;
}

// Editable row state
interface EditableRow extends AssetRow {
  _editing?: boolean;
  _saving?: boolean;
  _equipment_type?: string;
  _product_name?: string;
  _product_number?: string;
  _serial?: string;
  _tag?: string;
  _status?: string;
  _remarks?: string;
}

export default function SiteSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [siteId, setSiteId] = useState('');
  const [activeTab, setActiveTab] = useState<string>('Enclosure');
  const [tabData, setTabData] = useState<Record<string, EditableRow[]>>({});
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [photos, setPhotos] = useState<Record<string, AssetPhoto[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState<string | null>(null);
  
  // Dropdown options state
  const [equipmentTypes, setEquipmentTypes] = useState<Record<string, string[]>>({});
  const [productNames, setProductNames] = useState<Record<string, string[]>>({});
  const [tagStatuses, setTagStatuses] = useState<string[]>([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState<string | null>(null);
  
  // Add new row state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRowSaving, setNewRowSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({
    equipment_type: '',
    product_name: '',
    product_number: '',
    serial: '',
    tag: '',
    status: '',
    remarks: '',
  });
  const [newRowProductNames, setNewRowProductNames] = useState<string[]>([]);
  
  // New asset photo upload state (after insert)
  const [newAssetId, setNewAssetId] = useState<string | null>(null);
  const [newAssetPhotos, setNewAssetPhotos] = useState<AssetPhoto[]>([]);
  const [uploadingNewPhoto, setUploadingNewPhoto] = useState<string | null>(null);
  
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const photoChannelRef = useRef<RealtimeChannel | null>(null);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
      if (photoChannelRef.current) {
        supabase.removeChannel(photoChannelRef.current);
      }
    };
  }, []);

  // Fetch equipment types for a category (tab)
  const fetchEquipmentTypes = useCallback(async (category: string) => {
    // Cache check
    if (equipmentTypes[category]) return equipmentTypes[category];

    try {
      const { data, error: fetchError } = await supabase
        .from('v_equipment_types')
        .select('equipment_type')
        .eq('category', category);

      if (fetchError) {
        console.error('[SiteSearch] Error fetching equipment types:', fetchError);
        setError(`Failed to load equipment types: ${fetchError.message}`);
        return [];
      }

      const types = (data || []).map((d: { equipment_type: string }) => d.equipment_type).filter(Boolean);
      setEquipmentTypes(prev => ({ ...prev, [category]: types }));
      return types;
    } catch (err: any) {
      console.error('[SiteSearch] Error fetching equipment types:', err);
      setError(`Failed to load equipment types: ${err.message}`);
      return [];
    }
  }, [equipmentTypes]);

  // Fetch product names for category + equipment_type
  const fetchProductNames = useCallback(async (category: string, equipmentType: string) => {
    const cacheKey = `${category}:${equipmentType}`;
    if (productNames[cacheKey]) return productNames[cacheKey];

    try {
      const { data, error: fetchError } = await supabase
        .from('v_product_names')
        .select('product_name')
        .eq('category', category)
        .eq('equipment_type', equipmentType);

      if (fetchError) {
        console.error('[SiteSearch] Error fetching product names:', fetchError);
        setError(`Failed to load product names: ${fetchError.message}`);
        return [];
      }

      const names = (data || []).map((d: { product_name: string }) => d.product_name).filter(Boolean);
      setProductNames(prev => ({ ...prev, [cacheKey]: names }));
      return names;
    } catch (err: any) {
      console.error('[SiteSearch] Error fetching product names:', err);
      setError(`Failed to load product names: ${err.message}`);
      return [];
    }
  }, [productNames]);

  // Fetch product_number from product_catalog
  const fetchProductNumber = async (productName: string, category?: string, equipmentType?: string): Promise<string | null> => {
    try {
      let query = supabase
        .from('product_catalog')
        .select('product_number')
        .eq('product_name', productName)
        .limit(1);

      // Add filters if columns exist (optional)
      if (category) {
        query = query.eq('category', category);
      }
      if (equipmentType) {
        query = query.eq('equipment_type', equipmentType);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) {
        // If columns don't exist, try without filters
        console.warn('[SiteSearch] product_catalog query with filters failed, trying without:', fetchError);
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('product_catalog')
          .select('product_number')
          .eq('product_name', productName)
          .limit(1);

        if (fallbackError) {
          console.error('[SiteSearch] Error fetching product number:', fallbackError);
          return null;
        }
        return fallbackData?.[0]?.product_number || null;
      }

      return data?.[0]?.product_number || null;
    } catch (err) {
      console.error('[SiteSearch] Error fetching product number:', err);
      return null;
    }
  };

  // Fetch tag statuses (one-time, shared across all tabs)
  const fetchTagStatuses = useCallback(async () => {
    // Already loaded
    if (tagStatuses.length > 0) return tagStatuses;

    try {
      const { data, error: fetchError } = await supabase
        .from('v_tag_status')
        .select('tag_status');

      if (fetchError) {
        console.error('[SiteSearch] Error fetching tag statuses:', fetchError);
        setError(`Failed to load tag statuses: ${fetchError.message}`);
        return [];
      }

      // De-duplicate and sort A→Z
      const statuses = [...new Set((data || []).map((d: { tag_status: string }) => d.tag_status).filter(Boolean))].sort();
      setTagStatuses(statuses);
      return statuses;
    } catch (err: any) {
      console.error('[SiteSearch] Error fetching tag statuses:', err);
      setError(`Failed to load tag statuses: ${err.message}`);
      return [];
    }
  }, [tagStatuses]);

  // Load equipment types when tab changes
  useEffect(() => {
    if (hasSearched && activeTab) {
      fetchEquipmentTypes(activeTab);
    }
  }, [activeTab, hasSearched, fetchEquipmentTypes]);

  // Load tag statuses once on first search
  useEffect(() => {
    if (hasSearched) {
      fetchTagStatuses();
    }
  }, [hasSearched, fetchTagStatuses]);

  // Search handler
  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (!query) {
      setTabData({});
      setTabCounts({});
      setPhotos({});
      setHasSearched(false);
      setSiteId('');
      return;
    }

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSiteId(query);

    try {
      // Fetch data from all 5 tables in parallel
      const results = await Promise.all(
        TABS.map(async (tab) => {
          const table = TAB_TABLE_MAP[tab];
          const { data, error: queryError } = await supabase
            .from(table)
            .select('*')
            .eq('site_id', query)
            .order('date_text', { ascending: false });

          if (queryError) {
            console.error(`[SiteSearch] Error fetching ${table}:`, queryError);
            throw queryError;
          }

          return { tab, data: data || [] };
        })
      );

      // Build tabData and tabCounts
      const newTabData: Record<string, EditableRow[]> = {};
      const newTabCounts: Record<string, number> = {};

      results.forEach(({ tab, data }) => {
        newTabData[tab] = data.map(row => ({
          ...row,
          _equipment_type: row.equipment_type || '',
          _product_name: row.product_name || '',
          _product_number: row.product_number || '',
          _serial: row.serial || '',
          _tag: row.tag || '',
          _status: row.status || '',
          _remarks: row.remarks || '',
        }));
        newTabCounts[tab] = data.length;
      });

      setTabData(newTabData);
      setTabCounts(newTabCounts);

      // Collect all asset IDs for photo loading
      const allAssets: { table: string; id: string }[] = [];
      results.forEach(({ tab, data }) => {
        const table = TAB_TABLE_MAP[tab];
        data.forEach(row => {
          allAssets.push({ table, id: row.id });
        });
      });

      // Fetch photos for all assets
      await loadPhotosForAssets(allAssets);

      // Setup real-time subscriptions
      setupRealtimeSubscriptions(query, allAssets);

    } catch (err: any) {
      console.error('[SiteSearch] Error:', err);
      setError(err.message || 'Failed to search assets');
    } finally {
      setLoading(false);
    }
  };

  // Load photos for assets (query by asset_table + asset_id for each asset)
  const loadPhotosForAssets = async (assets: { table: string; id: string }[]) => {
    if (assets.length === 0) {
      setPhotos({});
      return;
    }

    try {
      // Build OR filter for all assets
      // Supabase doesn't support complex OR easily, so we fetch all photos for the tables and filter
      const tables = [...new Set(assets.map(a => a.table))];
      const assetIds = assets.map(a => a.id);

      const { data, error: photoError } = await supabase
        .from('asset_photos')
        .select('*')
        .in('asset_table', tables)
        .in('asset_id', assetIds);

      if (photoError) {
        console.error('[SiteSearch] Error loading photos:', photoError);
        return;
      }

      // Generate signed URLs for all photos
      const photosWithUrls = await Promise.all(
        (data || []).map(async (photo: AssetPhoto) => {
          try {
            const { data: signedData, error: signError } = await supabase.storage
              .from('asset-photos')
              .createSignedUrl(photo.storage_path, 3600); // 1 hour expiry

            if (signError) {
              console.error('[SiteSearch] Error creating signed URL:', signError);
              return { ...photo, signedUrl: '' };
            }
            return { ...photo, signedUrl: signedData.signedUrl };
          } catch (err) {
            console.error('[SiteSearch] Error creating signed URL:', err);
            return { ...photo, signedUrl: '' };
          }
        })
      );

      // Group photos by asset_table:asset_id
      const photoMap: Record<string, AssetPhoto[]> = {};
      photosWithUrls.forEach((photo) => {
        const key = `${photo.asset_table}:${photo.asset_id}`;
        if (!photoMap[key]) photoMap[key] = [];
        photoMap[key].push(photo);
      });

      setPhotos(photoMap);
    } catch (err) {
      console.error('[SiteSearch] Error loading photos:', err);
    }
  };

  // Setup real-time subscriptions for all tables
  const setupRealtimeSubscriptions = (siteIdParam: string, assets: { table: string; id: string }[]) => {
    // Cleanup existing subscriptions
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    if (photoChannelRef.current) {
      supabase.removeChannel(photoChannelRef.current);
    }

    // Subscribe to all 5 asset tables
    const channel = supabase.channel('asset-changes');
    
    Object.entries(TAB_TABLE_MAP).forEach(([tab, table]) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `site_id=eq.${siteIdParam}` },
        (payload) => {
          console.log(`[Realtime] ${table} change:`, payload);
          refreshTabData(tab, siteIdParam);
        }
      );
    });

    channel.subscribe((status) => {
      console.log('[Realtime] Asset subscription status:', status);
    });

    channelRef.current = channel;

    // Subscribe to asset_photos inserts (listen to all inserts, filter client-side)
    const photoChannel = supabase.channel('photo-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'asset_photos' },
        (payload) => {
          console.log('[Realtime] Photo inserted:', payload);
          // Reload photos for current assets
          loadPhotosForAssets(assets);
        }
      )
      .subscribe((status) => {
        console.log('[Realtime] Photo subscription status:', status);
      });

    photoChannelRef.current = photoChannel;
  };

  // Refresh data for a specific tab
  const refreshTabData = async (tab: string, siteIdParam: string) => {
    const table = TAB_TABLE_MAP[tab];
    try {
      const { data, error: queryError } = await supabase
        .from(table)
        .select('*')
        .eq('site_id', siteIdParam)
        .order('date_text', { ascending: false });

      if (queryError) throw queryError;

      setTabData(prev => ({
        ...prev,
        [tab]: (data || []).map(row => ({
          ...row,
          _equipment_type: row.equipment_type || '',
          _product_name: row.product_name || '',
          _product_number: row.product_number || '',
          _serial: row.serial || '',
          _tag: row.tag || '',
          _status: row.status || '',
          _remarks: row.remarks || '',
        })),
      }));
      setTabCounts(prev => ({
        ...prev,
        [tab]: data?.length || 0,
      }));
    } catch (err) {
      console.error(`[SiteSearch] Error refreshing ${tab}:`, err);
    }
  };

  // Handle input change for editable fields
  const handleFieldChange = (tab: string, rowId: string, field: string, value: string) => {
    setTabData(prev => ({
      ...prev,
      [tab]: prev[tab]?.map(row =>
        row.id === rowId ? { ...row, [field]: value, _editing: true } : row
      ) || [],
    }));
  };

  // Handle equipment_type change - clears product_name and product_number
  const handleEquipmentTypeChange = async (tab: string, rowId: string, value: string) => {
    setLoadingDropdowns(`${rowId}-product`);
    
    // Update equipment_type and clear dependent fields
    setTabData(prev => ({
      ...prev,
      [tab]: prev[tab]?.map(row =>
        row.id === rowId 
          ? { ...row, _equipment_type: value, _product_name: '', _product_number: '', _editing: true } 
          : row
      ) || [],
    }));

    // Fetch product names for new equipment type
    if (value) {
      await fetchProductNames(tab, value);
    }
    
    setLoadingDropdowns(null);
  };

  // Handle product_name change - auto-fills product_number if available
  const handleProductNameChange = async (tab: string, rowId: string, value: string, equipmentType: string) => {
    setLoadingDropdowns(`${rowId}-product_number`);
    
    // Update product_name
    setTabData(prev => ({
      ...prev,
      [tab]: prev[tab]?.map(row =>
        row.id === rowId 
          ? { ...row, _product_name: value, _editing: true } 
          : row
      ) || [],
    }));

    // Try to auto-fill product_number from product_catalog
    if (value) {
      const productNumber = await fetchProductNumber(value, tab, equipmentType);
      if (productNumber) {
        setTabData(prev => ({
          ...prev,
          [tab]: prev[tab]?.map(row =>
            row.id === rowId 
              ? { ...row, _product_number: productNumber } 
              : row
          ) || [],
        }));
      }
    }
    
    setLoadingDropdowns(null);
  };

  // Save row changes
  const handleSaveRow = async (tab: string, row: EditableRow) => {
    const table = TAB_TABLE_MAP[tab];
    
    // Mark as saving
    setTabData(prev => ({
      ...prev,
      [tab]: prev[tab]?.map(r =>
        r.id === row.id ? { ...r, _saving: true } : r
      ) || [],
    }));

    try {
      const { error: updateError } = await supabase
        .from(table)
        .update({
          equipment_type: row._equipment_type,
          product_name: row._product_name,
          product_number: row._product_number,
          serial: row._serial,
          tag: row._tag,
          status: row._status,
          remarks: row._remarks,
        })
        .eq('id', row.id);

      if (updateError) throw updateError;

      // Update local state
      setTabData(prev => ({
        ...prev,
        [tab]: prev[tab]?.map(r =>
          r.id === row.id
            ? {
                ...r,
                equipment_type: row._equipment_type,
                product_name: row._product_name,
                product_number: row._product_number,
                serial: row._serial,
                tag: row._tag,
                status: row._status,
                remarks: row._remarks,
                _editing: false,
                _saving: false,
              }
            : r
        ) || [],
      }));
    } catch (err: any) {
      console.error('[SiteSearch] Error saving row:', err);
      setError(`Failed to save: ${err.message}`);
      // Reset saving state
      setTabData(prev => ({
        ...prev,
        [tab]: prev[tab]?.map(r =>
          r.id === row.id ? { ...r, _saving: false } : r
        ) || [],
      }));
    }
  };

  // Handle photo upload
  const handlePhotoUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    tab: string,
    row: EditableRow,
    photoType: 'serial' | 'tag'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const table = TAB_TABLE_MAP[tab];
    const uploadKey = `${row.id}-${photoType}`;
    setUploadingPhoto(uploadKey);

    try {
      // Upload path: ${site_id}/${TABLE}/${row.id}/${photoType}/${file.name}
      const storagePath = `${siteId}/${table}/${row.id}/${photoType}/${file.name}`;

      // Upload to Supabase Storage with upsert
      const { error: uploadError } = await supabase.storage
        .from('asset-photos')
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Insert photo metadata into asset_photos table
      // Using existing schema: asset_id (UUID), asset_table, photo_type, storage_path, taken_at, taken_by
      const { error: dbError } = await supabase
        .from('asset_photos')
        .insert({
          asset_id: row.id,           // UUID
          asset_table: table,          // text
          photo_type: photoType,       // 'serial' | 'tag'
          storage_path: storagePath,
          taken_at: new Date().toISOString(),
          taken_by: user?.id || null,  // UUID of current user
          // url can be null - we display via signed URL
        });

      if (dbError) throw dbError;

      // Collect all current asset IDs and reload photos
      const allAssets: { table: string; id: string }[] = [];
      Object.entries(tabData).forEach(([t, rows]) => {
        const tbl = TAB_TABLE_MAP[t];
        rows.forEach(r => {
          allAssets.push({ table: tbl, id: r.id });
        });
      });
      await loadPhotosForAssets(allAssets);

    } catch (err: any) {
      console.error('[SiteSearch] Error uploading photo:', err);
      setError(`Failed to upload photo: ${err.message}`);
    } finally {
      setUploadingPhoto(null);
      // Reset file input
      e.target.value = '';
    }
  };

  // Get photos for a specific asset
  const getAssetPhotos = (table: string, assetId: string): AssetPhoto[] => {
    const key = `${table}:${assetId}`;
    return photos[key] || [];
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/');
    } catch (err) {
      console.error('Error signing out:', err);
    }
  };

  // Format date as '1-Jul-25'
  const formatDateText = (date: Date): string => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  // Reset new row form
  const resetNewRowForm = () => {
    setNewRow({
      equipment_type: '',
      product_name: '',
      product_number: '',
      serial: '',
      tag: '',
      status: '',
      remarks: '',
    });
    setNewRowProductNames([]);
    setNewAssetId(null);
    setNewAssetPhotos([]);
  };

  // Handle new row equipment type change
  const handleNewRowEquipmentTypeChange = async (value: string) => {
    setNewRow(prev => ({ ...prev, equipment_type: value, product_name: '', product_number: '' }));
    
    if (value) {
      const names = await fetchProductNames(activeTab, value);
      setNewRowProductNames(names);
    } else {
      setNewRowProductNames([]);
    }
  };

  // Handle new row product name change
  const handleNewRowProductNameChange = async (value: string) => {
    setNewRow(prev => ({ ...prev, product_name: value }));
    
    if (value) {
      const productNumber = await fetchProductNumber(value, activeTab, newRow.equipment_type);
      if (productNumber) {
        setNewRow(prev => ({ ...prev, product_number: productNumber }));
      }
    }
  };

  // Handle add new row
  const handleAddNewRow = async () => {
    // Validation
    if (!siteId) {
      setError('Site ID is required. Please search for a site first.');
      return;
    }
    if (!newRow.equipment_type) {
      setError('Equipment Type is required.');
      return;
    }
    if (!newRow.product_name) {
      setError('Product Name is required.');
      return;
    }
    if (!newRow.status) {
      setError('Tag & Serial Status is required.');
      return;
    }

    const table = TAB_TABLE_MAP[activeTab];
    setNewRowSaving(true);
    setError(null);

    try {
      const { data, error: insertError } = await supabase
        .from(table)
        .insert({
          site_id: siteId,
          date_text: formatDateText(new Date()),
          category: activeTab,
          equipment_type: newRow.equipment_type,
          product_name: newRow.product_name,
          product_number: newRow.product_number || null,
          serial: newRow.serial || 'NA',
          tag: newRow.tag || 'NA',
          status: newRow.status,
          remarks: newRow.remarks || null,
        })
        .select()
        .single();

      if (insertError) {
        console.error('[SiteSearch] Error inserting new row:', insertError);
        throw insertError;
      }

      console.log('[SiteSearch] New row inserted:', data);

      // Store new asset ID for photo upload
      setNewAssetId(data.id);

      // Refresh tab data
      await refreshTabData(activeTab, siteId);

      // Show success message
      setSuccessMessage(`New ${activeTab} asset added! You can now upload photos.`);
      setTimeout(() => setSuccessMessage(null), 5000);

    } catch (err: any) {
      console.error('[SiteSearch] Error adding new row:', err);
      setError(`Failed to add new row: ${err.message}`);
    } finally {
      setNewRowSaving(false);
    }
  };

  // Handle new asset photo upload
  const handleNewAssetPhotoUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    photoType: 'serial' | 'tag'
  ) => {
    const file = e.target.files?.[0];
    if (!file || !newAssetId) return;

    const table = TAB_TABLE_MAP[activeTab];
    setUploadingNewPhoto(photoType);

    try {
      // Upload path: ${site_id}/${TABLE}/${newAssetId}/${photoType}/${file.name}
      const storagePath = `${siteId}/${table}/${newAssetId}/${photoType}/${file.name}`;

      // Upload to Supabase Storage with upsert
      const { error: uploadError } = await supabase.storage
        .from('asset-photos')
        .upload(storagePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Insert photo metadata into asset_photos table
      const { data: photoData, error: dbError } = await supabase
        .from('asset_photos')
        .insert({
          asset_id: newAssetId,
          asset_table: table,
          photo_type: photoType,
          storage_path: storagePath,
          taken_at: new Date().toISOString(),
          taken_by: user?.id || null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // Generate signed URL for the new photo
      const { data: signedData } = await supabase.storage
        .from('asset-photos')
        .createSignedUrl(storagePath, 3600);

      // Add to local state with signed URL
      const newPhoto: AssetPhoto = {
        ...photoData,
        signedUrl: signedData?.signedUrl || '',
      };
      setNewAssetPhotos(prev => [...prev, newPhoto]);

      setSuccessMessage(`${photoType === 'serial' ? 'Serial' : 'Tag'} photo uploaded!`);
      setTimeout(() => setSuccessMessage(null), 3000);

    } catch (err: any) {
      console.error('[SiteSearch] Error uploading new asset photo:', err);
      setError(`Failed to upload photo: ${err.message}`);
    } finally {
      setUploadingNewPhoto(null);
      e.target.value = '';
    }
  };

  // Handle done with new asset (close form and refresh)
  const handleDoneWithNewAsset = async () => {
    // Refresh photos for all assets including new one
    const allAssets: { table: string; id: string }[] = [];
    Object.entries(tabData).forEach(([t, rows]) => {
      const tbl = TAB_TABLE_MAP[t];
      rows.forEach(r => {
        allAssets.push({ table: tbl, id: r.id });
      });
    });
    await loadPhotosForAssets(allAssets);

    // Reset form and close
    resetNewRowForm();
    setShowAddForm(false);
  };

  // Cancel add new row
  const handleCancelAddRow = () => {
    resetNewRowForm();
    setShowAddForm(false);
  };

  // Get current tab data
  const currentTabData = tabData[activeTab] || [];

  return (
    <div className="site-search-container">
      <header className="site-search-header">
        <h1>Site Search</h1>
        <button onClick={handleLogout} className="logout-button">
          Logout
        </button>
      </header>

      <div className="search-section">
        <div className="search-row">
          <input
            type="search"
            placeholder="Enter site ID (e.g., 2052, W2052)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="search-input"
          />
          <button onClick={handleSearch} className="search-button" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">{error}</div>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          {/* Category Tabs with counts */}
          {hasSearched && (
            <div className="tabs-container">
              <div className="tabs">
                {TABS.map((tab) => (
                  <button
                    key={tab}
                    className={`tab ${activeTab === tab ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab} ({tabCounts[tab] || 0})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Add New Row Button */}
          {hasSearched && siteId && (
            <div className="add-row-section">
              {!showAddForm ? (
                <button 
                  className="add-row-btn"
                  onClick={() => setShowAddForm(true)}
                >
                  + Add New Row
                </button>
              ) : (
                <div className="add-row-form">
                  <h3>Add New {activeTab} Asset</h3>
                  <div className="add-row-fields">
                    <div className="add-row-field">
                      <label>Equipment Type *</label>
                      <select
                        value={newRow.equipment_type}
                        onChange={(e) => handleNewRowEquipmentTypeChange(e.target.value)}
                        className="add-row-select"
                      >
                        <option value="">Select...</option>
                        {(equipmentTypes[activeTab] || []).map(et => (
                          <option key={et} value={et}>{et}</option>
                        ))}
                      </select>
                    </div>
                    <div className="add-row-field">
                      <label>Product Name *</label>
                      <select
                        value={newRow.product_name}
                        onChange={(e) => handleNewRowProductNameChange(e.target.value)}
                        className="add-row-select"
                        disabled={!newRow.equipment_type}
                      >
                        <option value="">Select...</option>
                        {newRowProductNames.map(pn => (
                          <option key={pn} value={pn}>{pn}</option>
                        ))}
                      </select>
                    </div>
                    <div className="add-row-field">
                      <label>Product #</label>
                      <input
                        type="text"
                        value={newRow.product_number}
                        onChange={(e) => setNewRow(prev => ({ ...prev, product_number: e.target.value }))}
                        className="add-row-input"
                        placeholder="Auto-filled or enter manually"
                      />
                    </div>
                    <div className="add-row-field">
                      <label>Serial</label>
                      <input
                        type="text"
                        value={newRow.serial}
                        onChange={(e) => setNewRow(prev => ({ ...prev, serial: e.target.value }))}
                        className="add-row-input"
                        placeholder="Enter serial or NA"
                      />
                    </div>
                    <div className="add-row-field">
                      <label>Tag</label>
                      <input
                        type="text"
                        value={newRow.tag}
                        onChange={(e) => setNewRow(prev => ({ ...prev, tag: e.target.value }))}
                        className="add-row-input"
                        placeholder="Enter tag or NA"
                      />
                    </div>
                    <div className="add-row-field">
                      <label>Tag & Serial Status *</label>
                      <select
                        value={newRow.status}
                        onChange={(e) => setNewRow(prev => ({ ...prev, status: e.target.value }))}
                        className="add-row-select"
                      >
                        <option value="">Select...</option>
                        {tagStatuses.map(ts => (
                          <option key={ts} value={ts}>{ts}</option>
                        ))}
                      </select>
                    </div>
                    <div className="add-row-field add-row-field-wide">
                      <label>Remarks</label>
                      <input
                        type="text"
                        value={newRow.remarks}
                        onChange={(e) => setNewRow(prev => ({ ...prev, remarks: e.target.value }))}
                        className="add-row-input"
                        placeholder="Optional remarks"
                        disabled={!!newAssetId}
                      />
                    </div>
                  </div>

                  {/* Photo Upload Section - shows after asset is saved */}
                  {newAssetId && (
                    <div className="add-row-photos-section">
                      <h4>Upload Photos (Optional)</h4>
                      <p className="add-row-photos-hint">Asset saved! You can now upload Serial and Tag photos.</p>
                      <div className="add-row-photos">
                        <div className="add-row-photo-group">
                          <span className="photo-label">Serial Photo:</span>
                          <div className="photo-thumbnails">
                            {newAssetPhotos
                              .filter(p => p.photo_type === 'serial')
                              .map(photo => (
                                photo.signedUrl && (
                                  <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noopener noreferrer">
                                    <img src={photo.signedUrl} alt="Serial" className="photo-thumbnail" />
                                  </a>
                                )
                              ))}
                          </div>
                          <label className="upload-btn">
                            {uploadingNewPhoto === 'serial' ? '...' : '+'}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleNewAssetPhotoUpload(e, 'serial')}
                              hidden
                              disabled={!!uploadingNewPhoto}
                            />
                          </label>
                        </div>
                        <div className="add-row-photo-group">
                          <span className="photo-label">Tag Photo:</span>
                          <div className="photo-thumbnails">
                            {newAssetPhotos
                              .filter(p => p.photo_type === 'tag')
                              .map(photo => (
                                photo.signedUrl && (
                                  <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noopener noreferrer">
                                    <img src={photo.signedUrl} alt="Tag" className="photo-thumbnail" />
                                  </a>
                                )
                              ))}
                          </div>
                          <label className="upload-btn">
                            {uploadingNewPhoto === 'tag' ? '...' : '+'}
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleNewAssetPhotoUpload(e, 'tag')}
                              hidden
                              disabled={!!uploadingNewPhoto}
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="add-row-actions">
                    {!newAssetId ? (
                      <>
                        <button
                          className="add-row-save-btn"
                          onClick={handleAddNewRow}
                          disabled={newRowSaving}
                        >
                          {newRowSaving ? 'Saving...' : 'Save New Row'}
                        </button>
                        <button
                          className="add-row-cancel-btn"
                          onClick={handleCancelAddRow}
                          disabled={newRowSaving}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="add-row-done-btn"
                        onClick={handleDoneWithNewAsset}
                        disabled={!!uploadingNewPhoto}
                      >
                        Done
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Success Message */}
          {successMessage && (
            <div className="success-banner">{successMessage}</div>
          )}

          {/* Results Table with inline editing */}
          {currentTabData.length > 0 && (
            <div className="results-section">
              <div className="results-table-wrapper">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Equipment Type</th>
                      <th>Product Name</th>
                      <th>Product #</th>
                      <th>Serial</th>
                      <th>Tag</th>
                      <th>Tag & Serial Status</th>
                      <th>Remarks</th>
                      <th>Photos</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTabData.map((row) => {
                      const table = TAB_TABLE_MAP[activeTab];
                      const rowPhotos = getAssetPhotos(table, row.id);
                      const serialPhotos = rowPhotos.filter(p => p.photo_type === 'serial');
                      const tagPhotos = rowPhotos.filter(p => p.photo_type === 'tag');
                      
                      // Get dropdown options
                      const eqTypes = equipmentTypes[activeTab] || [];
                      const prodNameKey = `${activeTab}:${row._equipment_type}`;
                      const prodNames = productNames[prodNameKey] || [];

                      return (
                        <tr key={row.id}>
                          <td>{row.date_text || '-'}</td>
                          <td>
                            <select
                              value={row._equipment_type || ''}
                              onChange={(e) => handleEquipmentTypeChange(activeTab, row.id, e.target.value)}
                              className="inline-select"
                              disabled={loadingDropdowns === `${row.id}-product`}
                            >
                              <option value="">Select...</option>
                              {eqTypes.map(et => (
                                <option key={et} value={et}>{et}</option>
                              ))}
                              {/* Include current value if not in list */}
                              {row._equipment_type && !eqTypes.includes(row._equipment_type) && (
                                <option value={row._equipment_type}>{row._equipment_type}</option>
                              )}
                            </select>
                          </td>
                          <td>
                            <select
                              value={row._product_name || ''}
                              onChange={(e) => handleProductNameChange(activeTab, row.id, e.target.value, row._equipment_type || '')}
                              className="inline-select"
                              disabled={!row._equipment_type || loadingDropdowns === `${row.id}-product_number`}
                            >
                              <option value="">Select...</option>
                              {prodNames.map(pn => (
                                <option key={pn} value={pn}>{pn}</option>
                              ))}
                              {/* Include current value if not in list */}
                              {row._product_name && !prodNames.includes(row._product_name) && (
                                <option value={row._product_name}>{row._product_name}</option>
                              )}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row._product_number || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_product_number', e.target.value)}
                              className="inline-input"
                              placeholder="Product #"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row._serial || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_serial', e.target.value)}
                              className="inline-input"
                              placeholder="Serial"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row._tag || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_tag', e.target.value)}
                              className="inline-input"
                              placeholder="Tag"
                            />
                          </td>
                          <td>
                            <select
                              value={row._status || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_status', e.target.value)}
                              className="inline-select"
                            >
                              <option value="">Select...</option>
                              {tagStatuses.map(ts => (
                                <option key={ts} value={ts}>{ts}</option>
                              ))}
                              {/* Include current value if not in list */}
                              {row._status && !tagStatuses.includes(row._status) && (
                                <option value={row._status}>{row._status}</option>
                              )}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row._remarks || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_remarks', e.target.value)}
                              className="inline-input"
                              placeholder="Remarks"
                            />
                          </td>
                          <td className="photos-cell">
                            <div className="photo-section">
                              <div className="photo-group">
                                <span className="photo-label">Serial:</span>
                                <div className="photo-thumbnails">
                                  {serialPhotos.map((photo) => (
                                    photo.signedUrl && (
                                      <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noopener noreferrer">
                                        <img src={photo.signedUrl} alt="Serial" className="photo-thumbnail" />
                                      </a>
                                    )
                                  ))}
                                </div>
                                <label className="upload-btn">
                                  {uploadingPhoto === `${row.id}-serial` ? '...' : '+'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handlePhotoUpload(e, activeTab, row, 'serial')}
                                    hidden
                                  />
                                </label>
                              </div>
                              <div className="photo-group">
                                <span className="photo-label">Tag:</span>
                                <div className="photo-thumbnails">
                                  {tagPhotos.map((photo) => (
                                    photo.signedUrl && (
                                      <a key={photo.id} href={photo.signedUrl} target="_blank" rel="noopener noreferrer">
                                        <img src={photo.signedUrl} alt="Tag" className="photo-thumbnail" />
                                      </a>
                                    )
                                  ))}
                                </div>
                                <label className="upload-btn">
                                  {uploadingPhoto === `${row.id}-tag` ? '...' : '+'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    onChange={(e) => handlePhotoUpload(e, activeTab, row, 'tag')}
                                    hidden
                                  />
                                </label>
                              </div>
                            </div>
                          </td>
                          <td>
                            <button
                              onClick={() => handleSaveRow(activeTab, row)}
                              disabled={!row._editing || row._saving}
                              className={`save-row-btn ${row._editing ? 'active' : ''}`}
                            >
                              {row._saving ? 'Saving...' : 'Save'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="results-count">
                Showing {currentTabData.length} row(s) in {activeTab}
              </p>
            </div>
          )}

          {/* No results message */}
          {hasSearched && Object.values(tabCounts).every(c => c === 0) && !loading && (
            <p className="no-results">No assets found for site "{searchQuery}"</p>
          )}

          {/* Empty tab */}
          {hasSearched && currentTabData.length === 0 && tabCounts[activeTab] === 0 && (
            <p className="no-results">No entries in {activeTab}</p>
          )}

          {/* Initial state */}
          {!hasSearched && !loading && (
            <p className="no-results">Enter a site ID and click Search</p>
          )}
        </>
      )}
    </div>
  );
}
