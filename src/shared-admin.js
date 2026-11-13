// Backend adapter. The website is not connected until a Supabase client is
// configured and this adapter is integrated with the existing UI.
export function createSharedAdmin(client) {
  async function checked(result) {
    const { data, error } = await result;
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    await checked(client.auth.signInWithPassword({ email, password }));
    try {
      const allowed = await checked(client.rpc('levelup_is_admin'));
      if (allowed !== true) throw new Error('This account is not authorized as an administrator.');
    } catch (error) {
      await client.auth.signOut();
      throw error;
    }
  }

  async function signOut() {
    await checked(client.auth.signOut());
  }

  async function submitApplication(application) {
    const row = {
      name: application.name,
      email: application.email,
      exam_provider: application.examProvider,
      certification: application.exam,
      certification_url: application.certificationUrl,
      essay: application.essay,
      amount: application.requestedAmount,
      household_income: application.householdIncome,
      agreement: application.agreement === true,
      age_confirmed: application.ageConfirmed === true
    };
    // No returning select: unauthenticated visitors must never read applications.
    await checked(client.from('levelup_applications').insert(row));
  }

  async function listApplications() {
    const rows = await checked(client.from('levelup_applications').select('*').order('created_at', { ascending: false }));
    return rows.map(row => ({
      id: row.id, name: row.name, email: row.email,
      examProvider: row.exam_provider, exam: row.certification,
      certificationUrl: row.certification_url, essay: row.essay,
      requestedAmount: row.amount, householdIncome: row.household_income, ageConfirmed: row.age_confirmed, status: row.status,
      practiceScore: row.practice_score, notes: row.notes,
      submittedAt: row.created_at
    }));
  }

  async function updateReview(id, review) {
    await checked(client.from('levelup_applications').update({
      status: review.status,
      practice_score: review.practiceScore === '' ? null : review.practiceScore,
      notes: review.notes
    }).eq('id', id).select('id').single());
  }

  async function deleteApplication(id) {
    await checked(client.from('levelup_applications').delete().eq('id', id).select('id').single());
  }

  async function listSponsors() {
    const rows = await checked(client.from('levelup_sponsors').select('*').order('created_at'));
    return rows.map(row => ({ id: row.id, name: row.name, url: row.website_url, image: row.image }));
  }

  async function saveSponsor(sponsor) {
    const row = { name: sponsor.name, website_url: sponsor.url || '', image: sponsor.image };
    if (sponsor.id) await checked(client.from('levelup_sponsors').update(row).eq('id', sponsor.id).select('id').single());
    else await checked(client.from('levelup_sponsors').insert(row));
  }

  async function deleteSponsor(id) {
    await checked(client.from('levelup_sponsors').delete().eq('id', id).select('id').single());
  }

  async function listTeam() {
    const rows = await checked(client.from('levelup_team').select('*').order('created_at'));
    return rows.map(row => ({ id: row.id, name: row.name, role: row.role, bio: row.bio, image: row.image }));
  }

  async function saveTeamMember(member) {
    const row = { name: member.name, role: member.role, bio: member.bio, image: member.image || '' };
    if (member.id) await checked(client.from('levelup_team').update(row).eq('id', member.id).select('id').single());
    else await checked(client.from('levelup_team').insert(row));
  }

  async function deleteTeamMember(id) {
    await checked(client.from('levelup_team').delete().eq('id', id).select('id').single());
  }

  return { signIn, signOut, submitApplication, listApplications, updateReview, deleteApplication, listSponsors, saveSponsor, deleteSponsor, listTeam, saveTeamMember, deleteTeamMember };
}
