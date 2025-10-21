import { createResource, Show, For } from 'solid-js';
import { getClientPB } from '~/lib/pocketbase-client-service';

// Example component that fetches events from PocketBase
const EventsList = () => {
  // Create a resource to fetch events
  const [events] = createResource(async () => {
    try {
      const pb = getClientPB();
      // Fetch all records from the 'events' collection
      const eventsList = await pb.collection('events').getFullList({
        sort: '-event_date',
      });
      return eventsList;
    } catch (error) {
      console.error('Error fetching events:', error);
      return [];
    }
  });

  return (
    <div class="p-4">
      <h2 class="text-2xl font-bold mb-4">Events</h2>
      <Show when={!events.loading} fallback={<div>Loading events...</div>}>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={events()}>
            {(event) => (
              <div class="bg-base-100 card shadow-md p-4 rounded-box">
                <h3 class="font-bold text-lg">{event.name}</h3>
                <p>{event.description}</p>
                <p class="text-sm text-gray-500">Date: {new Date(event.event_date).toLocaleDateString()}</p>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default EventsList;