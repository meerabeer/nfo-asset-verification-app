import { useState, useEffect, useRef } from 'react';
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
                      <th>Serial</th>
                      <th>Tag</th>
                      <th>Status</th>
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

                      return (
                        <tr key={row.id}>
                          <td>{row.date_text || '-'}</td>
                          <td>{row.equipment_type || '-'}</td>
                          <td>{row.product_name || '-'}</td>
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
                            <input
                              type="text"
                              value={row._status || ''}
                              onChange={(e) => handleFieldChange(activeTab, row.id, '_status', e.target.value)}
                              className="inline-input"
                              placeholder="Status"
                            />
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
