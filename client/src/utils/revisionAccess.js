export const hasActiveRevisionAccess = (revisionRequest) => Boolean(
  revisionRequest?.active && revisionRequest.status === 'granted'
);

const editableFields = new Set([
  'title',
  'abstract',
  'problemStatement',
  'objectives',
  'methodology',
  'technologies',
  'expectedOutcome',
  'description',
  'keywords',
  'domain',
  'proposedSolution',
]);

const fileTypes = new Set(['report', 'presentation', 'source']);

export const getRevisionPermissions = (revisionRequest) => ({
  fields: Array.isArray(revisionRequest?.editableFields)
    ? [...new Set(revisionRequest.editableFields.filter((field) => editableFields.has(field)))]
    : [],
  fileTypes: Array.isArray(revisionRequest?.fileTypes)
    ? [...new Set(revisionRequest.fileTypes.filter((fileType) => fileTypes.has(fileType)))]
    : [],
});

export const hasRevisionPermissionItems = (revisionRequest) => {
  const permissions = getRevisionPermissions(revisionRequest);
  return permissions.fields.length > 0 || permissions.fileTypes.length > 0;
};