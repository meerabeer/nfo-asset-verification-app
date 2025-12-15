import { useState, useEffect } from 'react';
import type { FormEvent, ChangeEvent } from 'react';
import { supabase } from '../lib/supabase';
import type { Asset, AssetPhoto } from '../types';
import '../styles/AssetDetail.css';

interface AssetDetailProps {
  asset: Asset;
  onClose: () => void;
  onUpdate: () => void;
}

export default function AssetDetail({ asset, onClose, onUpdate }: AssetDetailProps) {
  const [formData, setFormData] = useState({
    serial_number: asset.serial_number || '',
    tag_number: asset.tag_number || '',
    status: asset.status || '',
    remarks: asset.remarks || '',
  });
  
  // Cascading dropdown selections
  const [selectedCategory, setSelectedCategory] = useState<string>(asset.category || '');
  const [selectedEquipmentType, setSelectedEquipmentType] = useState<string>('');
  const [selectedProductName, setSelectedProductName] = useState<string>('');
  const [selectedTagStatus, setSelectedTagStatus] = useState<string>('');
  
  // Dropdown options
  const [categories, setCategories] = useState<string[]>([]);
  const [equipmentTypes, setEquipmentTypes] = useState<string[]>([]);
  const [productNames, setProductNames] = useState<string[]>([]);
  const [tagStatuses, setTagStatuses] = useState<string[]>([]);
  
  // Loading states
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingEquipmentTypes, setLoadingEquipmentTypes] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  
  // Error state
  const [error, setError] = useState<string | null>(null);
  
  const [serialPhoto, setSerialPhoto] = useState<File | null>(null);
  const [tagPhoto, setTagPhoto] = useState<File | null>(null);
  const [existingPhotos, setExistingPhotos] = useState<AssetPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load categories and tag statuses on mount
  useEffect(() => {
    loadCategories();
    loadTagStatuses();
    loadExistingPhotos();
  }, []);

  // Load equipment types when category changes
  useEffect(() => {
    if (selectedCategory) {
      loadEquipmentTypes(selectedCategory);
    } else {
      setEquipmentTypes([]);
      setSelectedEquipmentType('');
      setSelectedProductName('');
    }
  }, [selectedCategory]);

  // Load product names when equipment type changes
  useEffect(() => {
    if (selectedCategory && selectedEquipmentType) {
      loadProductNames(selectedCategory, selectedEquipmentType);
    } else {
      setProductNames([]);
      setSelectedProductName('');
    }
  }, [selectedEquipmentType]);

  const loadCategories = async () => {
    setLoadingCategories(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("v_categories")
        .select("category");
      
      if (error) throw error;
      
      // De-duplicate and sort A→Z
      const uniqueCategories = [...new Set(data?.map(d => d.category).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setCategories(uniqueCategories);
    } catch (err: any) {
      console.error('Error loading categories:', err);
      setError('Failed to load categories');
    } finally {
      setLoadingCategories(false);
    }
  };

  const loadEquipmentTypes = async (category: string) => {
    setLoadingEquipmentTypes(true);
    setError(null);
    // Clear dependent fields
    setSelectedEquipmentType('');
    setSelectedProductName('');
    setProductNames([]);
    
    try {
      const { data, error } = await supabase
        .from("v_equipment_types")
        .select("equipment_type")
        .eq("category", category);
      
      if (error) throw error;
      
      // De-duplicate and sort A→Z
      const uniqueTypes = [...new Set(data?.map(d => d.equipment_type).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setEquipmentTypes(uniqueTypes);
    } catch (err: any) {
      console.error('Error loading equipment types:', err);
      setError('Failed to load equipment types');
    } finally {
      setLoadingEquipmentTypes(false);
    }
  };

  const loadProductNames = async (category: string, equipmentType: string) => {
    setLoadingProducts(true);
    setError(null);
    // Clear dependent field
    setSelectedProductName('');
    
    try {
      const { data, error } = await supabase
        .from("v_product_names")
        .select("product_name")
        .eq("category", category)
        .eq("equipment_type", equipmentType);
      
      if (error) throw error;
      
      // De-duplicate and sort A→Z
      const uniqueProducts = [...new Set(data?.map(d => d.product_name).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setProductNames(uniqueProducts);
    } catch (err: any) {
      console.error('Error loading product names:', err);
      setError('Failed to load product names');
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadTagStatuses = async () => {
    setLoadingStatuses(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("v_tag_status")
        .select("tag_status");
      
      if (error) throw error;
      
      // De-duplicate and sort A→Z
      const uniqueStatuses = [...new Set(data?.map(d => d.tag_status).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setTagStatuses(uniqueStatuses);
    } catch (err: any) {
      console.error('Error loading tag statuses:', err);
      setError('Failed to load tag statuses');
    } finally {
      setLoadingStatuses(false);
    }
  };

  const loadExistingPhotos = async () => {
    try {
      const { data, error } = await supabase
        .from('asset_photos')
        .select('*')
        .eq('asset_id', asset.id);
      
      if (error) throw error;
      setExistingPhotos(data || []);
    } catch (err) {
      console.error('Error loading photos:', err);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, photoType: 'serial' | 'tag') => {
    const file = e.target.files?.[0];
    if (file) {
      if (photoType === 'serial') {
        setSerialPhoto(file);
      } else {
        setTagPhoto(file);
      }
    }
  };

  const uploadPhoto = async (file: File, photoType: 'serial' | 'tag') => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${asset.site_id}/${asset.id}/${photoType}.${fileExt}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('asset-photos')
      .upload(fileName, file, { upsert: true });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('asset-photos')
      .getPublicUrl(fileName);

    // Insert/update photo record in database
    const { error: dbError } = await supabase
      .from('asset_photos')
      .upsert({
        asset_id: asset.id,
        photo_type: photoType,
        storage_path: fileName,
        public_url: urlData.publicUrl,
      }, {
        onConflict: 'asset_id,photo_type'
      });

    if (dbError) throw dbError;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // Update asset details
      const { error: updateError } = await supabase
        .from('assets')
        .update({
          serial_number: formData.serial_number,
          tag_number: formData.tag_number,
          status: formData.status,
          remarks: formData.remarks,
        })
        .eq('id', asset.id);

      if (updateError) throw updateError;

      // Upload photos if selected
      setUploading(true);
      if (serialPhoto) {
        await uploadPhoto(serialPhoto, 'serial');
      }
      if (tagPhoto) {
        await uploadPhoto(tagPhoto, 'tag');
      }

      onUpdate();
    } catch (err: any) {
      console.error('Error saving asset:', err);
      alert('Error saving asset: ' + err.message);
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const getPhotoUrl = (photoType: 'serial' | 'tag') => {
    const photo = existingPhotos.find(p => p.photo_type === photoType);
    return photo?.public_url;
  };

  return (
    <div className="asset-detail-overlay" onClick={onClose}>
      <div className="asset-detail-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h2>Asset Details</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit} className="asset-form">
          <div className="form-group">
            <label htmlFor="category">Category</label>
            <select
              id="category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={loadingCategories}
            >
              {loadingCategories ? (
                <option value="">Loading…</option>
              ) : (
                <>
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="equipment_type">Equipment Type</label>
            <select
              id="equipment_type"
              value={selectedEquipmentType}
              onChange={(e) => setSelectedEquipmentType(e.target.value)}
              disabled={loadingEquipmentTypes || !selectedCategory}
            >
              {loadingEquipmentTypes ? (
                <option value="">Loading…</option>
              ) : (
                <>
                  <option value="">Select equipment type</option>
                  {equipmentTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="product_name">Product Name</label>
            <select
              id="product_name"
              value={selectedProductName}
              onChange={(e) => setSelectedProductName(e.target.value)}
              disabled={loadingProducts || !selectedEquipmentType}
            >
              {loadingProducts ? (
                <option value="">Loading…</option>
              ) : (
                <>
                  <option value="">Select product name</option>
                  {productNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="serial_number">Serial Number</label>
            <input
              id="serial_number"
              name="serial_number"
              type="text"
              value={formData.serial_number}
              onChange={handleInputChange}
              placeholder="Enter serial number"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tag_number">Tag Number</label>
            <input
              id="tag_number"
              name="tag_number"
              type="text"
              value={formData.tag_number}
              onChange={handleInputChange}
              placeholder="Enter tag number"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tag_status">Tag Status</label>
            <select
              id="tag_status"
              value={selectedTagStatus}
              onChange={(e) => setSelectedTagStatus(e.target.value)}
              disabled={loadingStatuses}
            >
              {loadingStatuses ? (
                <option value="">Loading…</option>
              ) : (
                <>
                  <option value="">Select tag status</option>
                  {tagStatuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </>
              )}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="remarks">Remarks</label>
            <textarea
              id="remarks"
              name="remarks"
              value={formData.remarks}
              onChange={handleInputChange}
              placeholder="Enter remarks"
              rows={3}
            />
          </div>

          <div className="photos-section">
            <h3>Photos</h3>
            
            <div className="photo-upload-group">
              <label>Serial Number Photo</label>
              {getPhotoUrl('serial') && (
                <div className="existing-photo">
                  <img src={getPhotoUrl('serial')} alt="Serial" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, 'serial')}
                className="file-input"
              />
              {serialPhoto && <p className="file-name">Selected: {serialPhoto.name}</p>}
            </div>

            <div className="photo-upload-group">
              <label>Tag Number Photo</label>
              {getPhotoUrl('tag') && (
                <div className="existing-photo">
                  <img src={getPhotoUrl('tag')} alt="Tag" />
                </div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e, 'tag')}
                className="file-input"
              />
              {tagPhoto && <p className="file-name">Selected: {tagPhoto.name}</p>}
            </div>
          </div>

          <div className="form-actions">
            <button type="button" onClick={onClose} className="cancel-button">
              Cancel
            </button>
            <button type="submit" disabled={saving || uploading} className="save-button">
              {saving ? 'Saving...' : uploading ? 'Uploading...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
