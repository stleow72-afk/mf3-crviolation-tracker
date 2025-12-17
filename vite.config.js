import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Replace 'REPO_NAME' with the actual name of your GitHub repository.
const REPO_NAME = 'mf3-crviolation-tracker'; 

export default defineConfig({
  plugins: [react()],
  // This ensures assets are loaded correctly from the GitHub Pages path
  base: `/${REPO_NAME}/`, 
})
