import { ApolloClient, InMemoryCache, HttpLink, split } from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createClient } from 'graphql-ws';
import { setContext } from '@apollo/client/link/context';

let currentToken = null;

export function setApolloToken(token) {
  currentToken = token;
}

const httpLink = new HttpLink({
  uri: 'https://ppouljnhjstsyglhjsyl.hasura.ap-south-1.nhost.run/v1/graphql',
});

const authLink = setContext((_, { headers }) => ({
  headers: {
    ...headers,
    ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
  },
}));

const wsLink = new GraphQLWsLink(
  createClient({
    url: 'wss://ppouljnhjstsyglhjsyl.hasura.ap-south-1.nhost.run/v1/graphql',
    connectionParams: () => ({
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : {},
    }),
  })
);

const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return definition.kind === 'OperationDefinition' && definition.operation === 'subscription';
  },
  wsLink,
  authLink.concat(httpLink)
);

export const apolloClient = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});