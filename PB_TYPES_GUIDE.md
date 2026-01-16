# PocketBase Type Synchronization Guide

This project uses manually defined TypeScript types for PocketBase collections to ensure type safety between the frontend and backend. Since we're unable to use automated tools like `pocketbase-typegen`, it's important to follow this guide when making changes to the PocketBase schema.

## Current Collections and Their Types

### Users Collection
- Location: `UserRecord` interface in `src/lib/pocketbase-types.ts`
- Standard PocketBase auth collection with additional fields

### CFP Applicants Collection
- Location: `CfpApplicantRecord` interface in `src/lib/pocketbase-types.ts`
- Fields: `affiliation`, `bio`, `social_handles`, `user` (relation to users)

### CFP Submissions Collection
- Location: `CfpSubmissionRecord` interface in `src/lib/pocketbase-types.ts`
- Fields: `session_title`, `abstract`, `key_takeaways`, `technical_requirements`, `notes`, `applicant` (relation to cfp_applicants)

## How to Update Types When Schema Changes

When you modify the PocketBase schema (add, remove, or modify fields), you need to update the corresponding TypeScript interfaces in `src/lib/pocketbase-types.ts`. Here's the process:

1. **Update the Interface**:
   - Add/remove fields from the appropriate interface
   - Set correct types for new fields (string, number, boolean, or complex types)
   - Mark optional fields with `?`

2. **Update Utility Functions**:
   - Modify any affected functions in `src/lib/pocketbase-utils.ts` to use the new field types
   - Make sure function signatures match the updated schema

3. **Update Components**:
   - Update any components that use these collections to reflect the new type structure
   - Update form fields, display elements, etc.

4. **Test the Changes**:
   - Run the application and test all features that interact with the modified collections
   - Run TypeScript checks to ensure type safety

## Example of Adding a New Field

Let's say you added a `website` field to the CFP Applicant collection:

1. Update the interface:
```typescript
export interface CfpApplicantRecord extends Record {
  id: string;
  affiliation: string;
  bio: string;
  social_handles?: any; // JSON field
  user: string; // relation to users collection
  website?: string;     // new optional field
  created: string;
  updated: string;
}
```

2. Update any functions that create or modify this record to include the new field.

## Running Type Generation Script

While we can't automatically generate types, we have a script to remind developers about manual updates:

```bash
pnpm generate:pb-types
```

This will remind you to manually update types based on your schema changes.

## Maintaining Type Safety

- Always use the exported types in your components and services
- Keep the interfaces in sync with your PocketBase schema
- Use the utility functions in `pocketbase-utils.ts` which are typed
- Add type guards when necessary to check for specific record types

With this approach, we maintain the same level of type safety as an automated solution while having more control over the typing process.