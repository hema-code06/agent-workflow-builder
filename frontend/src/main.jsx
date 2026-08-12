import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NhostProvider } from '@nhost/react';
import { ApolloProvider } from '@apollo/client';
import { nhost } from './nhost';
import { apolloClient } from './apollo';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={apolloClient}>
        <App />
      </ApolloProvider>
    </NhostProvider>
  </StrictMode>
);