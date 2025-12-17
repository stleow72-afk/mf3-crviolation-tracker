export default {
  plugins: {
    // This is the correct, fixed syntax needed for GitHub Actions to build successfully.
    '@tailwindcss/postcss': {}, 
    'autoprefixer': {},
  },
}