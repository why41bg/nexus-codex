import type { ContributionInvite, ContributionRecord } from '@/types';
import AdminPageHeader from './AdminPageHeader';
import InviteManagement from './InviteManagement';
import ContributionReview from './ContributionReview';

interface Props {
  invites: ContributionInvite[];
  records: ContributionRecord[];
}

export default function ContributionsTab({ invites, records }: Props) {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="账号共享"
        description="通过邀请码让社区成员共享闲置账号，并在此审核入池申请"
      />
      <InviteManagement invites={invites} />
      <ContributionReview records={records} />
    </div>
  );
}
