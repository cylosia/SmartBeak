import {
  addTeamMemberProcedure,
  listTeamActivityProcedure,
  listTeamMembers,
  removeTeamMemberProcedure,
  updateTeamMemberRoleProcedure,
} from "./procedures/manage-members";
import {
  createTeamProcedure,
  deleteTeamProcedure,
  listTeams,
  updateTeamProcedure,
} from "./procedures/manage-teams";

export const teamsRouter = {
  list: listTeams,
  create: createTeamProcedure,
  update: updateTeamProcedure,
  delete: deleteTeamProcedure,
  members: {
    list: listTeamMembers,
    add: addTeamMemberProcedure,
    remove: removeTeamMemberProcedure,
    updateRole: updateTeamMemberRoleProcedure,
  },
  activity: listTeamActivityProcedure,
};
