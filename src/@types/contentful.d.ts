import {Entry, SyncCollection} from 'contentful'

export interface IChangelistFields {
  /** Title (UI only) */
  entryTitle: string

  /** Changelist ID */
  changelistId: string

  /** Feature Name (Branch) */
  featureName: string

  /** Approved By Legal */
  approvedByLegal: 'Yes'[]

  /** Review State  */
  reviewState:
    | 'Initial authoring'
    | 'Needs Review'
    | 'Needs changes'
    | 'Ready to publish'

  /** Changelist Entries */
  entries?: Entry<{[fieldId: string]: unknown}>[] | undefined
}

/** A collection of content updates to be included in a deployment. */

export interface IChangelist extends Entry<IChangelistFields> {
  sys: {
    id: string
    type: string
    createdAt: string
    updatedAt: string
    locale: string
    contentType: {
      sys: {
        id: 'changelist'
        linkType: 'ContentType'
        type: 'Link'
      }
    }
  }
}

export type LocalSyncCollection = Pick<
  SyncCollection,
  'entries' | 'assets' | 'deletedEntries' | 'deletedAssets' | 'nextSyncToken'
> // ## preserve only relevant properties
