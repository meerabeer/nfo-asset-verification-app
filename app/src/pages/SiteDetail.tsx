import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Site, Asset, CategoryType } from '../types';
import AssetDetail from '../components/AssetDetail';
import '../styles/SiteDetail.css';

const categories: CategoryType[] = ['RAN-Active', 'RAN-Passive', 'MW-Active', 'MW-Passive', 'Enclosure'];

export default function SiteDetail() {
  const { siteId } = useParams<{ siteId: string }>();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeCategory, setActiveCategory] = useState<CategoryType>('RAN-Active');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (siteId) {
      loadSiteData();
    }
  }, [siteId]);

  useEffect(() => {
    if (siteId) {
      loadAssets();
    }
  }, [siteId, activeCategory]);

  const loadSiteData = async () => {
    try {
      const { data, error } = await supabase
        .from('sites')
        .select('*')
        .eq('id', siteId)
        .single();
      
      if (error) throw error;
      setSite(data);
    } catch (err) {
      console.error('Error loading site:', err);
    }
  };

  const loadAssets = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('assets')
        .select('*')
        .eq('site_id', siteId)
        .eq('category', activeCategory)
        .order('name');
      
      if (error) throw error;
      setAssets(data || []);
    } catch (err) {
      console.error('Error loading assets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAssetUpdate = () => {
    loadAssets();
    setSelectedAsset(null);
  };

  return (
    <div className="site-detail-container">
      <header className="site-detail-header">
        <button onClick={() => navigate('/search')} className="back-button">
          ← Back
        </button>
        <div className="site-info">
          <h1>{site?.site_name || 'Loading...'}</h1>
          <p>{site?.site_code}</p>
        </div>
      </header>

      <div className="tabs-container">
        <div className="tabs">
          {categories.map((category) => (
            <button
              key={category}
              className={`tab ${activeCategory === category ? 'active' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="assets-section">
        {loading ? (
          <div className="loading">Loading assets...</div>
        ) : (
          <div className="assets-list">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="asset-card"
                onClick={() => setSelectedAsset(asset)}
              >
                <h3 className="asset-name">{asset.name || 'Unnamed Asset'}</h3>
                {asset.model && <p className="asset-model">{asset.model}</p>}
                <div className="asset-details">
                  {asset.serial_number && (
                    <span className="asset-tag">Serial: {asset.serial_number}</span>
                  )}
                  {asset.tag_number && (
                    <span className="asset-tag">Tag: {asset.tag_number}</span>
                  )}
                  {asset.status && (
                    <span className={`asset-status status-${asset.status.toLowerCase()}`}>
                      {asset.status}
                    </span>
                  )}
                </div>
                {asset.remarks && (
                  <p className="asset-remarks">{asset.remarks}</p>
                )}
              </div>
            ))}
            {assets.length === 0 && (
              <p className="no-results">No assets found in this category</p>
            )}
          </div>
        )}
      </div>

      {selectedAsset && (
        <AssetDetail
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onUpdate={handleAssetUpdate}
        />
      )}
    </div>
  );
}
