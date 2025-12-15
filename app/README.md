# NFO Asset Verification App

A mobile-first React + Vite + TypeScript application for managing and verifying network field operations assets with Supabase backend.

## Features

- 🔐 User authentication with Supabase
- 🔍 Site search and filtering
- 📋 Asset management by categories:
  - RAN-Active
  - RAN-Passive
  - MW-Active
  - MW-Passive
  - Enclosure
- ✏️ Asset detail editing (serial number, tag number, status, remarks)
- 📸 Image upload for serial and tag photos
- 📱 Responsive mobile-first design
- ☁️ Cloud storage integration with Supabase Storage

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- A Supabase account and project

## Supabase Setup

Before running the app, you need to set up your Supabase project with the following:

### 1. Database Tables

Create the following tables in your Supabase database:

**sites table:**
```sql
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_name TEXT NOT NULL,
  site_code TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**assets table:**
```sql
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id UUID REFERENCES sites(id),
  category TEXT NOT NULL,
  name TEXT,
  model TEXT,
  serial_number TEXT,
  tag_number TEXT,
  status TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**asset_photos table:**
```sql
CREATE TABLE asset_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id UUID REFERENCES assets(id),
  photo_type TEXT NOT NULL CHECK (photo_type IN ('serial', 'tag')),
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(asset_id, photo_type)
);
```

### 2. Storage Bucket

Create a storage bucket named `asset-photos`:

1. Go to Storage in your Supabase dashboard
2. Create a new bucket called `asset-photos`
3. Set it to **public** or configure appropriate policies

### 3. Row Level Security (Optional but Recommended)

Enable RLS and create policies for your tables based on your security requirements.

## Installation

1. Clone the repository and navigate to the app directory:
```bash
cd /workspaces/nfo-asset-verification-app/app
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file from the example:
```bash
cp .env.example .env
```

4. Edit the `.env` file and add your Supabase credentials:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

You can find these values in your Supabase project settings under API.

## Running the Application

Start the development server:
```bash
npm run dev
```

The app will be available at `http://localhost:5173`

## Building for Production

To create a production build:
```bash
npm run build
```

The built files will be in the `dist` directory.

To preview the production build locally:
```bash
npm run preview
```

## Project Structure

```
app/
├── src/
│   ├── components/       # Reusable components
│   │   ├── AssetDetail.tsx
│   │   └── ProtectedRoute.tsx
│   ├── contexts/         # React contexts
│   │   └── AuthContext.tsx
│   ├── lib/             # Utilities and config
│   │   └── supabase.ts
│   ├── pages/           # Page components
│   │   ├── Login.tsx
│   │   ├── SiteSearch.tsx
│   │   └── SiteDetail.tsx
│   ├── styles/          # CSS files
│   │   ├── Login.css
│   │   ├── SiteSearch.css
│   │   ├── SiteDetail.css
│   │   └── AssetDetail.css
│   ├── types/           # TypeScript types
│   │   └── index.ts
│   ├── App.tsx          # Main app component
│   ├── App.css
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles
├── .env                 # Environment variables (create from .env.example)
├── .env.example         # Example environment variables
├── package.json
└── README.md
```

## Usage

1. **Login**: Sign in with your Supabase credentials
2. **Search Sites**: Browse and search for sites by name, code, or location
3. **View Site Details**: Click on a site to view its assets organized by category tabs
4. **Edit Assets**: Click on an asset to open the detail drawer where you can:
   - Update serial number and tag number
   - Change status
   - Add remarks
   - Upload photos for serial and tag numbers
5. **Upload Photos**: Photos are automatically uploaded to Supabase Storage and linked to the asset

## Tech Stack

- **Frontend Framework**: React 18
- **Build Tool**: Vite
- **Language**: TypeScript
- **Routing**: React Router v6
- **Backend**: Supabase
- **Authentication**: Supabase Auth
- **Database**: PostgreSQL (via Supabase)
- **Storage**: Supabase Storage
- **Styling**: CSS (mobile-first approach)

## License

MIT
