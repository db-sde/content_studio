import {
  Info, BarChart3, HelpCircle, GraduationCap, Award, CheckSquare,
  FileText, CreditCard, Landmark, Table, BookOpen, UserCheck,
  Briefcase, Star, MessageSquare
} from 'lucide-react';

export const PAGE_TYPES = {
  UNIVERSITY: 'university',
  COURSE: 'course',
  SPECIALIZATION: 'specialization'
};

// Shared repeater sub-field configs (reused across page types where the ACF spec repeats them)
const REVIEWS_SUBFIELDS = [
  { key: 'review_text', label: 'Review Text', type: 'textarea', placeholder: 'e.g. This program helped me transition into...' },
  { key: 'reviewer_name', label: 'Reviewer Name', type: 'text', placeholder: 'e.g. Rohit Sharma' },
  { key: 'reviewer_label', label: 'Reviewer Label', type: 'text', placeholder: 'e.g. Batch of 2024' }
];

const FAQS_SUBFIELDS = [
  { key: 'question', label: 'Question', type: 'text', placeholder: 'e.g. Is this program approved by UGC?' },
  { key: 'answer', label: 'Answer', type: 'textarea', placeholder: 'e.g. Yes, this program is recognized by the UGC-DEB.' }
];

const JOB_PROFILES_SUBFIELDS = [
  { key: 'job_title', label: 'Job Title', type: 'text', placeholder: 'e.g. Product Marketing Manager' },
  { key: 'avg_salary', label: 'Average Salary', type: 'text', placeholder: 'e.g. ₹10 LPA' }
];

const HIGHLIGHTS_SUBFIELDS = [
  { key: 'highlight_title', label: 'Highlight Title', type: 'text', placeholder: 'e.g. Industry-Aligned Curriculum' },
  { key: 'highlight_description', label: 'Highlight Description', type: 'text', placeholder: 'e.g. Designed with input from 50+ hiring partners' }
];

// Concrete step-by-step facts behind the AI-generated "Admission Steps" narrative — without this,
// the AI has no real process to describe and has to invent a generic one from scratch.
const ADMISSION_STEPS_SUBFIELDS = [
  { key: 'step_title', label: 'Step Title', type: 'text', placeholder: 'e.g. Submit Online Application' },
  { key: 'step_description', label: 'Step Description', type: 'textarea', placeholder: 'e.g. Fill the online application form with personal and academic details' }
];

// Real placement numbers behind the AI-generated "Placement Content" narrative — that field's own
// instructions already warn "do not invent statistics," but without this there was nothing for
// the AI to cite, so it either invented numbers anyway or wrote around them vaguely.
const PLACEMENT_STATS_SUBFIELDS = [
  { key: 'stat_label', label: 'Stat Label', type: 'text', placeholder: 'e.g. Average Package' },
  { key: 'stat_value', label: 'Stat Value', type: 'text', placeholder: 'e.g. ₹8 LPA' }
];

// Real exam format facts behind the AI-generated "Examination Content" narrative.
const EXAM_DETAILS_SUBFIELDS = [
  { key: 'detail_label', label: 'Detail Label', type: 'text', placeholder: 'e.g. Exam Mode' },
  { key: 'detail_value', label: 'Detail Value', type: 'text', placeholder: 'e.g. Online, Proctored' }
];

// Real partner-bank EMI terms behind the AI-generated "EMI Content" narrative (University only —
// course/specialization only ever show a plain emi_amount fact with no AI narrative around it).
const EMI_PARTNERS_SUBFIELDS = [
  { key: 'bank_name', label: 'Bank / Partner Name', type: 'text', placeholder: 'e.g. HDFC Bank' },
  { key: 'emi_terms', label: 'EMI Terms', type: 'text', placeholder: 'e.g. 0% interest, up to 12 months' }
];

export const schemas = {
  [PAGE_TYPES.UNIVERSITY]: {
    id: PAGE_TYPES.UNIVERSITY,
    title: 'University Page',
    sections: [
      {
        id: 'basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'university_full_name', type: 'TEXT_INPUT', label: 'University Full Name', placeholder: 'e.g. Narsee Monjee Institute...' },
          { key: 'hero_description', type: 'TEXTAREA', label: 'Hero Short Description', placeholder: 'A short description of the university', required: true, rows: 3, aiAssist: { instructions: 'Write a 1-2 sentence hook that names the university and its flagship credential or mode of study. This is the first text a prospective student reads.' } },
          { key: 'established_year', type: 'TEXT_INPUT', label: 'Established Year', placeholder: 'e.g. 1981' },
          { key: 'naac_grade', type: 'TEXT_INPUT', label: 'NAAC Grade', placeholder: 'e.g. NAAC A++' },
          { key: 'ugc_approved', type: 'TEXT_INPUT', label: 'UGC Approved', placeholder: 'e.g. UGC-DEB Approved' },
          { key: 'mode_of_learning', type: 'TEXT_INPUT', label: 'Mode of Learning', placeholder: 'e.g. 100% Online' },
          { key: 'starting_fee', type: 'TEXT_INPUT', label: 'Starting Fee', placeholder: 'e.g. ₹55,000' },
          { key: 'num_programs', type: 'TEXT_INPUT', label: 'Number of Programs', placeholder: 'e.g. 15+' }
        ]
      },
      {
        id: 'about',
        title: 'About the University',
        icon: 'GraduationCap',
        fields: [
          { key: 'about_heading', type: 'TEXT_INPUT', label: 'About Section Heading', placeholder: 'e.g. About NMIMS' },
          { key: 'about_additional_notes', type: 'TEXTAREA', label: 'Additional Notes', placeholder: 'Any extra facts about the university not captured elsewhere - the AI will use these when writing About Content', rows: 3 },
          { key: 'about_content', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Detailed content about the university', required: true, aiAssist: { instructions: 'Write 2-3 short paragraphs introducing the university - its history, standing, and what makes it a credible choice for distance/online learners.' } }
        ]
      },
      {
        id: 'why_choose',
        title: 'Why Choose',
        icon: 'Star',
        fields: [
          { key: 'why_choose_heading', type: 'TEXT_INPUT', label: 'Why Choose Section Heading', placeholder: 'e.g. Why Choose NMIMS' },
          { key: 'why_choose_additional_notes', type: 'TEXTAREA', label: 'Additional Notes', placeholder: 'Any extra reasons or facts not captured elsewhere - the AI will use these when writing Why Choose Content', rows: 3 },
          { key: 'why_choose_content', type: 'RICH_TEXT', label: 'Why Choose Content', placeholder: 'Reasons to choose this university', aiAssist: { instructions: 'Write a short persuasive passage (2-3 short paragraphs or a tight bulleted list) on why a student should choose this university specifically, grounded only in the facts provided (accreditations, mode, fees, etc.).' } }
        ]
      },
      {
        id: 'facts',
        title: 'Facts',
        icon: 'CheckSquare',
        fields: [
          { key: 'facts_heading', type: 'TEXT_INPUT', label: 'Facts Section Heading', placeholder: 'e.g. Quick Facts' },
          { key: 'facts', type: 'REPEATER', label: 'Facts', subfields: [
            { key: 'fact_title', label: 'Fact Title', type: 'text', placeholder: 'e.g. Established' },
            { key: 'fact_description', label: 'Fact Description', type: 'text', placeholder: 'e.g. 1981' }
          ] }
        ]
      },
      {
        id: 'accreditations',
        title: 'Rankings & Accreditations',
        icon: 'Award',
        fields: [
          { key: 'accreditations_heading', type: 'TEXT_INPUT', label: 'Accreditations Section Heading', placeholder: 'e.g. Rankings & Accreditations' },
          { key: 'accreditations', type: 'REPEATER', label: 'Accreditations', subfields: [
            { key: 'body_name', label: 'Body Name', type: 'text', placeholder: 'e.g. NAAC' },
            { key: 'body_descriptor', label: 'Body Descriptor', type: 'text', placeholder: 'e.g. Grade' },
            { key: 'body_detail', label: 'Body Detail', type: 'text', placeholder: 'e.g. A++' }
          ] }
        ]
      },
      {
        id: 'programs',
        title: 'Programs',
        icon: 'Table',
        fields: [
          { key: 'programs_heading', type: 'TEXT_INPUT', label: 'Programs Section Heading', placeholder: 'e.g. Programs Offered' },
          { key: 'programs_intro', type: 'TEXT_INPUT', label: 'Programs Intro', placeholder: 'Short intro line above the programs table' },
          { key: 'programs_table', type: 'REPEATER', label: 'Programs', subfields: [
            { key: 'program_name', label: 'Program Name', type: 'text', placeholder: 'e.g. MBA in General Management' },
            { key: 'program_fee', label: 'Program Fee', type: 'text', placeholder: 'e.g. ₹1.5L' },
            { key: 'program_eligibility', label: 'Program Eligibility', type: 'textarea', placeholder: 'e.g. Graduation in any discipline' }
          ] }
        ]
      },
      {
        id: 'admission',
        title: 'Admission',
        icon: 'UserCheck',
        fields: [
          { key: 'admission_heading', type: 'TEXT_INPUT', label: 'Admission Section Heading', placeholder: 'e.g. Admission Process' },
          { key: 'admission_steps_list', type: 'REPEATER', label: 'Admission Steps List', subfields: ADMISSION_STEPS_SUBFIELDS },
          { key: 'admission_steps', type: 'RICH_TEXT', label: 'Admission Steps', placeholder: 'Describe the admission process, steps can be an ordered list', aiAssist: { instructions: 'Describe the admission process as a short ordered sequence of steps a prospective student needs to follow.' } },
          { key: 'admission_fee_note', type: 'TEXT_INPUT', label: 'Admission Fee Note', placeholder: 'e.g. ₹1,200/- one-time non-refundable' }
        ]
      },
      {
        id: 'emi',
        title: 'EMI',
        icon: 'Landmark',
        fields: [
          { key: 'emi_heading', type: 'TEXT_INPUT', label: 'EMI Section Heading', placeholder: 'e.g. EMI Options' },
          { key: 'emi_partners', type: 'REPEATER', label: 'EMI Partners', subfields: EMI_PARTNERS_SUBFIELDS },
          { key: 'emi_additional_notes', type: 'TEXTAREA', label: 'Additional Notes', placeholder: 'Any extra EMI facts not captured above - the AI will use these when writing EMI Content', rows: 3 },
          { key: 'emi_content', type: 'RICH_TEXT', label: 'EMI Content', placeholder: 'Describe EMI plans and partner banks', aiAssist: { instructions: 'Explain the EMI options and partner banks available for fee payment, in plain reassuring terms, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'exam',
        title: 'Examination',
        icon: 'FileText',
        fields: [
          { key: 'exam_heading', type: 'TEXT_INPUT', label: 'Examination Section Heading', placeholder: 'e.g. Examination Pattern' },
          { key: 'exam_details', type: 'REPEATER', label: 'Exam Details', subfields: EXAM_DETAILS_SUBFIELDS },
          { key: 'exam_content', type: 'RICH_TEXT', label: 'Examination Content', placeholder: 'Describe the examination pattern', aiAssist: { instructions: 'Describe the examination pattern and format students can expect, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'faculty',
        title: 'Faculty',
        icon: 'Briefcase',
        fields: [
          { key: 'faculty_heading', type: 'TEXT_INPUT', label: 'Faculty Section Heading', placeholder: 'e.g. Meet Our Faculty' },
          { key: 'faculty_intro', type: 'TEXTAREA', label: 'Faculty Intro', placeholder: 'Short intro about the faculty', rows: 2, aiAssist: { instructions: 'Write a short 1-2 sentence introduction to the faculty section, grounded only in the facts provided.' } },
          { key: 'faculty_members', type: 'REPEATER', label: 'Faculty Members', subfields: [
            { key: 'member_name', label: 'Member Name', type: 'text', placeholder: 'e.g. Dr. Anita Rao' },
            { key: 'member_program', label: 'Member Program', type: 'text', placeholder: 'e.g. MBA Marketing' },
            { key: 'member_designation', label: 'Member Designation', type: 'text', placeholder: 'e.g. Professor' },
            { key: 'member_qualification', label: 'Member Qualification', type: 'text', placeholder: 'e.g. PhD, IIM Ahmedabad' }
          ] }
        ]
      },
      {
        id: 'placement',
        title: 'Placement',
        icon: 'BarChart3',
        fields: [
          { key: 'placement_heading', type: 'TEXT_INPUT', label: 'Placement Section Heading', placeholder: 'e.g. Placement Support' },
          { key: 'placement_stats', type: 'REPEATER', label: 'Placement Stats', subfields: PLACEMENT_STATS_SUBFIELDS },
          { key: 'placement_additional_notes', type: 'TEXTAREA', label: 'Additional Notes', placeholder: 'Any extra placement facts not captured above - the AI will use these when writing Placement Content', rows: 3 },
          { key: 'placement_content', type: 'RICH_TEXT', label: 'Placement Content', placeholder: 'Describe placement support and outcomes', aiAssist: { instructions: 'Describe placement support and outcomes, grounded only in the facts provided (do not invent statistics).' } }
        ]
      },
      {
        id: 'reviews_sec',
        title: 'Reviews',
        icon: 'MessageSquare',
        fields: [
          { key: 'reviews_heading', type: 'TEXT_INPUT', label: 'Reviews Section Heading', placeholder: 'e.g. Student Reviews' },
          { key: 'reviews', type: 'REPEATER', label: 'Reviews', subfields: REVIEWS_SUBFIELDS }
        ]
      },
      {
        id: 'faqs_sec',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs_heading', type: 'TEXT_INPUT', label: 'FAQs Section Heading', placeholder: 'e.g. Frequently Asked Questions' },
          { key: 'faqs', type: 'REPEATER', label: 'FAQs', subfields: FAQS_SUBFIELDS }
        ]
      },
      {
        id: 'seo',
        title: 'SEO',
        icon: 'BookOpen',
        fields: [
          { key: 'seo_title', type: 'TEXT_INPUT', label: 'SEO Title', placeholder: 'e.g. NMIMS Distance Learning | DegreeBaba', aiAssist: { instructions: 'Write an SEO title (max 60 characters) that includes the university name and its most distinctive credential.' } },
          { key: 'meta_description', type: 'TEXTAREA', label: 'Meta Description', placeholder: 'A short SEO meta description', rows: 2, aiAssist: { instructions: 'Write an SEO meta description (max 155 characters) summarizing this page, optimized for search click-through, grounded only in the facts provided.' } }
        ]
      }
    ]
  },

  [PAGE_TYPES.COURSE]: {
    id: PAGE_TYPES.COURSE,
    title: 'Course Page',
    sections: [
      {
        id: 'basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'program_name', type: 'TEXT_INPUT', label: 'Program Name', placeholder: 'e.g. MBA in General Management', required: true },
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'linked_university', type: 'SEARCHABLE_SELECT', directoryPageType: 'university', label: 'Linked University', placeholder: 'Search approved universities…' },
          { key: 'hero_description', type: 'TEXTAREA', label: 'Hero Short Description', placeholder: 'A short description of the course', required: true, rows: 3, aiAssist: { instructions: 'Write a 1-2 sentence hook naming the program and university, highlighting its most distinctive credential.' } },
          { key: 'duration', type: 'TEXT_INPUT', label: 'Duration', placeholder: 'e.g. 2 Years' },
          { key: 'mode', type: 'TEXT_INPUT', label: 'Mode', placeholder: 'e.g. Online' },
          { key: 'naac_grade', type: 'TEXT_INPUT', label: 'NAAC Grade', placeholder: 'e.g. NAAC A++' },
          { key: 'ugc_status', type: 'TEXT_INPUT', label: 'UGC Status', placeholder: 'e.g. UGC-DEB Approved' },
          { key: 'total_fee', type: 'TEXT_INPUT', label: 'Total Fee', placeholder: 'e.g. ₹1.5L' },
          { key: 'starting_fee', type: 'TEXT_INPUT', label: 'Starting Fee', placeholder: 'e.g. ₹35,000' },
          { key: 'num_specializations', type: 'TEXT_INPUT', label: 'Number of Specializations', placeholder: 'e.g. 6' },
          { key: 'eligibility_summary', type: 'TEXT_INPUT', label: 'Eligibility Summary', placeholder: 'e.g. Graduation in any discipline' }
        ]
      },
      {
        id: 'about',
        title: 'About the Course',
        icon: 'GraduationCap',
        fields: [
          { key: 'about_heading', type: 'TEXT_INPUT', label: 'About Section Heading', placeholder: 'e.g. About the Program' },
          { key: 'about_content', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Detailed content about the course', required: true, aiAssist: { instructions: 'Write 2-3 short paragraphs describing the course - what it covers, who it is for, and its key credential.' } }
        ]
      },
      {
        id: 'highlights',
        title: 'Highlights',
        icon: 'Star',
        fields: [
          { key: 'highlights_heading', type: 'TEXT_INPUT', label: 'Highlights Section Heading', placeholder: 'e.g. Program Highlights' },
          { key: 'highlights', type: 'REPEATER', label: 'Highlights', subfields: HIGHLIGHTS_SUBFIELDS }
        ]
      },
      {
        id: 'accreditations',
        title: 'Accreditations',
        icon: 'Award',
        fields: [
          { key: 'accreditations_heading', type: 'TEXT_INPUT', label: 'Accreditations Section Heading', placeholder: 'e.g. Accreditations' }
        ]
      },
      {
        id: 'specializations',
        title: 'Specializations',
        icon: 'Table',
        fields: [
          { key: 'specializations_heading', type: 'TEXT_INPUT', label: 'Specializations Section Heading', placeholder: 'e.g. Available Specializations' },
          { key: 'specializations_intro', type: 'TEXT_INPUT', label: 'Specializations Intro', placeholder: 'Short intro line above specializations' }
        ]
      },
      {
        id: 'fee',
        title: 'Fee',
        icon: 'CreditCard',
        fields: [
          { key: 'fee_heading', type: 'TEXT_INPUT', label: 'Fee Section Heading', placeholder: 'e.g. Fee Structure' },
          { key: 'fee_plans', type: 'REPEATER', label: 'Fee Plans', subfields: [
            { key: 'plan_name', label: 'Plan Name', type: 'text', placeholder: 'e.g. Semester Plan' },
            { key: 'plan_amount', label: 'Plan Amount', type: 'text', placeholder: 'e.g. ₹35,000' },
            { key: 'plan_total', label: 'Plan Total', type: 'text', placeholder: 'e.g. ₹1,40,000' }
          ] },
          { key: 'emi_amount', type: 'TEXT_INPUT', label: 'EMI Amount', placeholder: 'e.g. ₹8,750/month' },
          { key: 'validity', type: 'TEXT_INPUT', label: 'Validity', placeholder: 'e.g. 4 Years' }
        ]
      },
      {
        id: 'eligibility',
        title: 'Eligibility',
        icon: 'CheckSquare',
        fields: [
          { key: 'eligibility_heading', type: 'TEXT_INPUT', label: 'Eligibility Section Heading', placeholder: 'e.g. Eligibility Criteria' },
          { key: 'eligibility_content', type: 'RICH_TEXT', label: 'Eligibility Content', placeholder: 'Describe eligibility requirements', required: true, aiAssist: { instructions: 'Describe the eligibility requirements for admission in plain, precise terms, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'admission',
        title: 'Admission',
        icon: 'UserCheck',
        fields: [
          { key: 'admission_heading', type: 'TEXT_INPUT', label: 'Admission Section Heading', placeholder: 'e.g. Admission Process' },
          { key: 'admission_steps_list', type: 'REPEATER', label: 'Admission Steps List', subfields: ADMISSION_STEPS_SUBFIELDS },
          { key: 'admission_steps', type: 'RICH_TEXT', label: 'Admission Steps', placeholder: 'Describe the admission process', aiAssist: { instructions: 'Describe the admission process as a short ordered sequence of steps a prospective student needs to follow.' } },
          { key: 'admission_fee_note', type: 'TEXT_INPUT', label: 'Admission Fee Note', placeholder: 'e.g. ₹1,200/- one-time non-refundable' }
        ]
      },
      {
        id: 'syllabus',
        title: 'Syllabus',
        icon: 'BookOpen',
        fields: [
          { key: 'syllabus_heading', type: 'TEXT_INPUT', label: 'Syllabus Section Heading', placeholder: 'e.g. Syllabus' },
          { key: 'syllabus_subjects', type: 'REPEATER', label: 'Syllabus Subjects', subfields: [
            { key: 'semester', label: 'Semester', type: 'text', placeholder: 'e.g. Semester 1' },
            { key: 'subjects', label: 'Subjects', type: 'textarea', placeholder: 'e.g. Marketing Management, Financial Accounting, Business Statistics' }
          ] },
          { key: 'syllabus_content', type: 'RICH_TEXT', label: 'Syllabus Content', placeholder: 'Describe the syllabus / subjects', required: true, aiAssist: { instructions: 'Summarize the syllabus/subjects covered in this course, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'placement',
        title: 'Placement',
        icon: 'BarChart3',
        fields: [
          { key: 'placement_heading', type: 'TEXT_INPUT', label: 'Placement Section Heading', placeholder: 'e.g. Placement Support' },
          { key: 'placement_stats', type: 'REPEATER', label: 'Placement Stats', subfields: PLACEMENT_STATS_SUBFIELDS },
          { key: 'placement_content', type: 'RICH_TEXT', label: 'Placement Content', placeholder: 'Describe placement support and outcomes', aiAssist: { instructions: 'Describe placement support and outcomes, grounded only in the facts provided (do not invent statistics).' } }
        ]
      },
      {
        id: 'jobs',
        title: 'Job Opportunities',
        icon: 'Briefcase',
        fields: [
          { key: 'jobs_heading', type: 'TEXT_INPUT', label: 'Jobs Section Heading', placeholder: 'e.g. Job Opportunities' },
          { key: 'job_profiles', type: 'REPEATER', label: 'Job Profiles', subfields: JOB_PROFILES_SUBFIELDS }
        ]
      },
      {
        id: 'certificate',
        title: 'Certificate',
        icon: 'FileText',
        fields: [
          { key: 'certificate_description', type: 'TEXTAREA', label: 'Certificate Description', placeholder: 'Post-completion, enrolled students...', rows: 3, aiAssist: { instructions: 'Describe the certificate/credential awarded on completion, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'reviews_sec',
        title: 'Reviews',
        icon: 'MessageSquare',
        fields: [
          { key: 'reviews', type: 'REPEATER', label: 'Reviews', subfields: REVIEWS_SUBFIELDS }
        ]
      },
      {
        id: 'faqs_sec',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs_heading', type: 'TEXT_INPUT', label: 'FAQs Section Heading', placeholder: 'e.g. Frequently Asked Questions' },
          { key: 'faqs', type: 'REPEATER', label: 'FAQs', subfields: FAQS_SUBFIELDS }
        ]
      },
      {
        id: 'seo',
        title: 'SEO',
        icon: 'Landmark',
        fields: [
          { key: 'seo_title', type: 'TEXT_INPUT', label: 'SEO Title', placeholder: 'e.g. MBA in General Management | NMIMS', aiAssist: { instructions: 'Write an SEO title (max 60 characters) including the program name and university.' } },
          { key: 'meta_description', type: 'TEXTAREA', label: 'Meta Description', placeholder: 'A short SEO meta description', rows: 2, aiAssist: { instructions: 'Write an SEO meta description (max 155 characters) summarizing this page, optimized for search click-through, grounded only in the facts provided.' } }
        ]
      }
    ]
  },

  [PAGE_TYPES.SPECIALIZATION]: {
    id: PAGE_TYPES.SPECIALIZATION,
    title: 'Specialization Page',
    sections: [
      {
        id: 'basic_info',
        title: 'Basic Info',
        icon: 'Info',
        fields: [
          { key: 'spec_name', type: 'TEXT_INPUT', label: 'Specialization Name', placeholder: 'e.g. MBA in Marketing Management', required: true },
          { key: 'university_name', type: 'TEXT_INPUT', label: 'University Name', placeholder: 'e.g. NMIMS', required: true },
          { key: 'linked_university', type: 'SEARCHABLE_SELECT', directoryPageType: 'university', label: 'Linked University', placeholder: 'Search approved universities…' },
          { key: 'linked_course', type: 'SEARCHABLE_SELECT', directoryPageType: 'course', scopedByFieldKey: 'linked_university', label: 'Linked Course', placeholder: 'Search approved courses…' },
          { key: 'duration', type: 'TEXT_INPUT', label: 'Duration', placeholder: 'e.g. 2 Years' },
          { key: 'mode', type: 'TEXT_INPUT', label: 'Mode', placeholder: 'e.g. Online' },
          { key: 'naac_grade', type: 'TEXT_INPUT', label: 'NAAC Grade', placeholder: 'e.g. NAAC A++' },
          { key: 'ugc_status', type: 'TEXT_INPUT', label: 'UGC Status', placeholder: 'e.g. UGC-DEB Approved' },
          { key: 'total_fee', type: 'TEXT_INPUT', label: 'Total Fee', placeholder: 'e.g. ₹1,96,000', required: true },
          { key: 'eligibility_summary', type: 'TEXT_INPUT', label: 'Eligibility Summary', placeholder: 'e.g. Graduation in any discipline' }
        ]
      },
      {
        id: 'about',
        title: 'About the Specialization',
        icon: 'GraduationCap',
        fields: [
          { key: 'about_heading', type: 'TEXT_INPUT', label: 'About Section Heading', placeholder: 'e.g. About This Specialization' },
          { key: 'about_content', type: 'RICH_TEXT', label: 'About Content', placeholder: 'Full description of the specialization', required: true, aiAssist: { instructions: 'Write 2-3 short paragraphs describing this specialization track - what it covers and why it is valuable, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'highlights',
        title: 'Highlights',
        icon: 'Star',
        fields: [
          { key: 'highlights_heading', type: 'TEXT_INPUT', label: 'Highlights Section Heading', placeholder: 'e.g. Program Highlights' },
          { key: 'highlights', type: 'REPEATER', label: 'Highlights', subfields: HIGHLIGHTS_SUBFIELDS }
        ]
      },
      {
        id: 'eligibility',
        title: 'Eligibility',
        icon: 'CheckSquare',
        fields: [
          { key: 'eligibility_heading', type: 'TEXT_INPUT', label: 'Eligibility Section Heading', placeholder: 'e.g. Eligibility Criteria' },
          { key: 'eligibility_content', type: 'RICH_TEXT', label: 'Eligibility Content', placeholder: 'Describe eligibility requirements', required: true, aiAssist: { instructions: 'Describe the eligibility requirements for admission in plain, precise terms, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'fee',
        title: 'Fee',
        icon: 'CreditCard',
        fields: [
          { key: 'fee_heading', type: 'TEXT_INPUT', label: 'Fee Section Heading', placeholder: 'e.g. Fee Structure' },
          { key: 'fee_plans', type: 'REPEATER', label: 'Fee Plans', subfields: [
            { key: 'plan_name', label: 'Plan Name', type: 'text', placeholder: 'e.g. Semester Plan' },
            { key: 'plan_amount', label: 'Plan Amount', type: 'text', placeholder: 'e.g. ₹35,000' },
            { key: 'plan_total', label: 'Plan Total', type: 'text', placeholder: 'e.g. ₹1,40,000' }
          ] },
          { key: 'emi_amount', type: 'TEXT_INPUT', label: 'EMI Amount', placeholder: 'e.g. ₹8,750/month', required: true }
        ]
      },
      {
        id: 'other_specs',
        title: 'Other Specializations',
        icon: 'Table',
        fields: [
          { key: 'other_specs_heading', type: 'TEXT_INPUT', label: 'Other Specializations Section Heading', placeholder: 'e.g. Other Specializations & Fees' },
          { key: 'other_specs', type: 'REPEATER', label: 'Other Specializations', subfields: [
            { key: 'other_spec_name', label: 'Specialization Name', type: 'text', placeholder: 'e.g. MBA in Finance' },
            { key: 'other_spec_fee', label: 'Fee Per Semester', type: 'text', placeholder: 'e.g. ₹55,000' }
          ] }
        ]
      },
      {
        id: 'syllabus',
        title: 'Syllabus',
        icon: 'BookOpen',
        fields: [
          { key: 'syllabus_heading', type: 'TEXT_INPUT', label: 'Syllabus Section Heading', placeholder: 'e.g. Syllabus' },
          { key: 'syllabus_subjects', type: 'REPEATER', label: 'Syllabus Subjects', subfields: [
            { key: 'semester', label: 'Semester', type: 'text', placeholder: 'e.g. Semester 1' },
            { key: 'subjects', label: 'Subjects', type: 'textarea', placeholder: 'e.g. Marketing Management, Financial Accounting, Business Statistics' }
          ] },
          { key: 'syllabus_content', type: 'RICH_TEXT', label: 'Syllabus Content', placeholder: 'Describe subjects covered per semester', required: true, aiAssist: { instructions: 'Summarize the subjects covered per semester in this specialization, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'exam',
        title: 'Examination',
        icon: 'FileText',
        fields: [
          { key: 'exam_heading', type: 'TEXT_INPUT', label: 'Examination Section Heading', placeholder: 'e.g. Examination Pattern' },
          { key: 'exam_details', type: 'REPEATER', label: 'Exam Details', subfields: EXAM_DETAILS_SUBFIELDS },
          { key: 'exam_content', type: 'RICH_TEXT', label: 'Examination Content', placeholder: 'Describe the examination pattern', aiAssist: { instructions: 'Describe the examination pattern and format students can expect, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'admission',
        title: 'Admission Process',
        icon: 'UserCheck',
        fields: [
          { key: 'admission_heading', type: 'TEXT_INPUT', label: 'Admission Section Heading', placeholder: 'e.g. Admission Process' },
          { key: 'admission_steps_list', type: 'REPEATER', label: 'Admission Steps List', subfields: ADMISSION_STEPS_SUBFIELDS },
          { key: 'admission_steps', type: 'RICH_TEXT', label: 'Admission Steps', placeholder: 'Describe the admission process', required: true, aiAssist: { instructions: 'Describe the admission process as a short ordered sequence of steps a prospective student needs to follow.' } },
          { key: 'admission_fee_note', type: 'TEXT_INPUT', label: 'Admission Fee Note', placeholder: 'e.g. ₹1,200/- one-time non-refundable' }
        ]
      },
      {
        id: 'placement',
        title: 'Placement',
        icon: 'BarChart3',
        fields: [
          { key: 'placement_heading', type: 'TEXT_INPUT', label: 'Placement Section Heading', placeholder: 'e.g. Placement Support' },
          { key: 'placement_stats', type: 'REPEATER', label: 'Placement Stats', subfields: PLACEMENT_STATS_SUBFIELDS },
          { key: 'placement_content', type: 'RICH_TEXT', label: 'Placement Content', placeholder: 'Describe placement support and outcomes', aiAssist: { instructions: 'Describe placement support and outcomes, grounded only in the facts provided (do not invent statistics).' } }
        ]
      },
      {
        id: 'jobs',
        title: 'Job Opportunities',
        icon: 'Briefcase',
        fields: [
          { key: 'jobs_heading', type: 'TEXT_INPUT', label: 'Jobs Section Heading', placeholder: 'e.g. Job Opportunities' },
          { key: 'job_profiles', type: 'REPEATER', label: 'Job Profiles', subfields: JOB_PROFILES_SUBFIELDS }
        ]
      },
      {
        id: 'certificate',
        title: 'Certificate',
        icon: 'Award',
        fields: [
          { key: 'certificate_heading', type: 'TEXT_INPUT', label: 'Certificate Section Heading', placeholder: 'e.g. Certificate' },
          { key: 'certificate_description', type: 'TEXTAREA', label: 'Certificate Description', placeholder: 'Post-completion, enrolled students...', rows: 3, aiAssist: { instructions: 'Describe the certificate/credential awarded on completion, grounded only in the facts provided.' } }
        ]
      },
      {
        id: 'reviews_sec',
        title: 'Reviews',
        icon: 'MessageSquare',
        fields: [
          { key: 'reviews', type: 'REPEATER', label: 'Reviews', subfields: REVIEWS_SUBFIELDS }
        ]
      },
      {
        id: 'faqs_sec',
        title: 'FAQs',
        icon: 'HelpCircle',
        fields: [
          { key: 'faqs_heading', type: 'TEXT_INPUT', label: 'FAQs Section Heading', placeholder: 'e.g. Frequently Asked Questions' },
          { key: 'faqs', type: 'REPEATER', label: 'FAQs', subfields: FAQS_SUBFIELDS }
        ]
      },
      {
        id: 'seo',
        title: 'SEO',
        icon: 'Landmark',
        fields: [
          { key: 'seo_title', type: 'TEXT_INPUT', label: 'SEO Title', placeholder: 'e.g. MBA in Marketing Management | NMIMS', aiAssist: { instructions: 'Write an SEO title (max 60 characters) including the specialization name and university.' } },
          { key: 'meta_description', type: 'TEXTAREA', label: 'Meta Description', placeholder: 'A short SEO meta description', rows: 2, aiAssist: { instructions: 'Write an SEO meta description (max 155 characters) summarizing this page, optimized for search click-through, grounded only in the facts provided.' } }
        ]
      }
    ]
  }
};

// Every scalar/rich-text field is required by default; SEO fields are exempt since they're fully
// AI-generated from the rest of the page's data rather than typed by the writer, and "additional
// notes" fields are exempt since they exist purely as an optional catch-all for facts that don't
// fit a structured repeater - forcing them required would defeat that purpose.
// REPEATER fields (Highlights, Reviews, FAQs, Job Profiles, etc.) are never forced required here:
// how many of these a real institution/course actually has varies and can legitimately be zero
// (a brand-new course may have no reviews yet, a university may have no FAQs written), so a
// blanket minimum count would block otherwise-complete drafts. Applied here (once, on the schema
// objects themselves) rather than hand-set per field so it can't drift as fields are added, and
// so the UI (asterisks, "Required Fields" badges) stays in sync for free.
const OPTIONAL_FIELD_KEYS = new Set([
  'seo_title', 'meta_description',
  'about_additional_notes', 'why_choose_additional_notes', 'emi_additional_notes', 'placement_additional_notes'
]);

Object.values(schemas).forEach(schema => {
  schema.sections.forEach(section => {
    section.fields.forEach(field => {
      field.required = field.type !== 'REPEATER' && !OPTIONAL_FIELD_KEYS.has(field.key);
    });
  });
});

// Derive display metadata (field counts) directly from the schemas above so it can never drift
const countFields = (schema) => schema.sections.reduce((sum, sec) => sum + sec.fields.length, 0);

export const SCHEMA_DETAILS = {
  [PAGE_TYPES.UNIVERSITY]: {
    id: PAGE_TYPES.UNIVERSITY,
    title: 'University Page',
    fieldCount: countFields(schemas[PAGE_TYPES.UNIVERSITY]),
    estimatedTime: '35 mins'
  },
  [PAGE_TYPES.COURSE]: {
    id: PAGE_TYPES.COURSE,
    title: 'Course Page',
    fieldCount: countFields(schemas[PAGE_TYPES.COURSE]),
    estimatedTime: '35 mins'
  },
  [PAGE_TYPES.SPECIALIZATION]: {
    id: PAGE_TYPES.SPECIALIZATION,
    title: 'Specialization Page',
    fieldCount: countFields(schemas[PAGE_TYPES.SPECIALIZATION]),
    estimatedTime: '35 mins'
  }
};

export const getIcon = (name) => {
  const icons = { Info, BarChart3, HelpCircle, GraduationCap, Award, CheckSquare, FileText, CreditCard, Landmark, Table, BookOpen, UserCheck, Briefcase, Star, MessageSquare };
  return icons[name] || Info;
};

// Generates the initial form state based on the selected schema
export const getInitialState = (pageType) => {
  const schema = schemas[pageType];
  if (!schema) return {};

  const state = {
    page_type: pageType
  };

  schema.sections.forEach(section => {
    section.fields.forEach(field => {
      state[field.key] = field.type === 'REPEATER' ? [] : '';
    });
  });

  return state;
};

// Returns true if a repeater row has at least one non-empty sub-field
const isRowFilled = (row) => Object.values(row || {}).some(v => v !== undefined && String(v).trim() !== '');

// Cleans a repeater array down to non-empty rows, normalized to the sub-field keys
const cleanRepeater = (rows = [], subfields) => {
  return rows
    .filter(isRowFilled)
    .map(row => {
      const cleaned = {};
      subfields.forEach(sf => {
        cleaned[sf.key] = row[sf.key] || '';
      });
      return cleaned;
    });
};

// Strips tags rather than exact-matching a specific empty serialization like '<p></p>' — TipTap
// can produce other blank forms (e.g. '<p></p><p></p>' from multiple empty lines, or '<p><br></p>')
// that an exact string match would miss, silently treating a visually-blank field as "already
// filled" (this exact helper is reused server-side by batchGenerate.js's onlyEmpty filter).
export const isRichTextEmpty = (val) => {
  if (!val) return true;
  const textOnly = val.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return textOnly === '';
};

// Transforms the state into the flat ACF-matching JSON payload (field keys match the WP ACF config exactly)
export const transformToACF = (state, pageType) => {
  const schema = schemas[pageType];
  if (!schema) return {};

  const output = {};

  schema.sections.forEach(section => {
    section.fields.forEach(field => {
      if (field.type === 'REPEATER') {
        output[field.key] = cleanRepeater(state[field.key], field.subfields);
      } else {
        output[field.key] = state[field.key] || '';
      }
    });
  });

  return output;
};

// Checks whether a single field satisfies its "required" rule
const fieldPasses = (state, field) => {
  if (field.type === 'REPEATER') {
    const rows = (state[field.key] || []).filter(isRowFilled);
    return rows.length >= (field.minItems || 1);
  }
  if (field.type === 'RICH_TEXT') {
    return !isRichTextEmpty(state[field.key]);
  }
  return !!state[field.key] && String(state[field.key]).trim() !== '';
};

// Validates the state and returns an object: { isValid: boolean, errors: string[], invalidFields: Record<string, boolean> }
export const validateState = (state, pageType) => {
  const schema = schemas[pageType];
  const errors = [];
  const invalidFields = {};
  if (!schema) return { isValid: true, errors, invalidFields };

  schema.sections.forEach(sec => {
    sec.fields.forEach(field => {
      if (!field.required) return;
      if (!fieldPasses(state, field)) {
        invalidFields[field.key] = true;
        if (field.type === 'REPEATER') {
          const count = (state[field.key] || []).filter(isRowFilled).length;
          errors.push(`"${field.label}" requires at least ${field.minItems || 1} item(s), found ${count} (${sec.title}).`);
        } else {
          errors.push(`"${field.label}" is required (${sec.title}).`);
        }
      }
    });
  });

  return {
    isValid: errors.length === 0,
    errors,
    invalidFields
  };
};

// Like validateState, but treats every AI-assisted field as irrelevant regardless of its own
// `required` flag — used to gate the Intern's "Generate All AI Fields" button, which by
// definition must be clickable before any AI field has content. validateState (used for the
// final Download/Validate flow) still requires AI fields once they've actually been generated.
export const validateFactsOnly = (state, pageType) => {
  const schema = schemas[pageType];
  const errors = [];
  const invalidFields = {};
  if (!schema) return { isValid: true, errors, invalidFields };

  schema.sections.forEach(sec => {
    sec.fields.forEach(field => {
      if (!field.required || field.aiAssist) return;
      if (!fieldPasses(state, field)) {
        invalidFields[field.key] = true;
        if (field.type === 'REPEATER') {
          const count = (state[field.key] || []).filter(isRowFilled).length;
          errors.push(`"${field.label}" requires at least ${field.minItems || 1} item(s), found ${count} (${sec.title}).`);
        } else {
          errors.push(`"${field.label}" is required (${sec.title}).`);
        }
      }
    });
  });

  return {
    isValid: errors.length === 0,
    errors,
    invalidFields
  };
};

// Computes the completion percentage of required fields. `isFieldRelevant` (defaults to counting
// everything) lets a caller exclude fields the current viewer has no say over right now — e.g. an
// Intern's AI-generated fields, which stay empty until generation and aren't theirs to fill —
// so "100%" means "done with what's actually mine to do" rather than "the whole document exists."
export const calculateProgress = (state, pageType, isFieldRelevant = () => true) => {
  const schema = schemas[pageType];
  if (!schema) return 0;

  let requiredCount = 0;
  let passedCount = 0;

  schema.sections.forEach(sec => {
    sec.fields.forEach(field => {
      if (!field.required || !isFieldRelevant(field)) return;
      requiredCount++;
      if (fieldPasses(state, field)) passedCount++;
    });
  });

  if (requiredCount === 0) return 100;
  return Math.round((passedCount / requiredCount) * 100);
};

// Gets the completion state of a section: 'empty' | 'partial' | 'complete'. Same `isFieldRelevant`
// convention as calculateProgress above.
export const getSectionStatus = (state, section, isFieldRelevant = () => true) => {
  let hasAnyFilled = false;
  let hasAllRequiredFilled = true;
  let requiredCount = 0;

  section.fields.forEach(field => {
    const val = state[field.key];
    let isFilled;
    if (field.type === 'REPEATER') {
      isFilled = (val || []).some(isRowFilled);
    } else if (field.type === 'RICH_TEXT') {
      isFilled = !isRichTextEmpty(val);
    } else {
      isFilled = !!val && String(val).trim() !== '';
    }

    if (isFilled) hasAnyFilled = true;

    if (field.required && isFieldRelevant(field)) {
      requiredCount++;
      if (!fieldPasses(state, field)) hasAllRequiredFilled = false;
    }
  });

  if (requiredCount === 0) {
    return hasAnyFilled ? 'complete' : 'empty';
  }
  if (!hasAnyFilled) return 'empty';
  return hasAllRequiredFilled ? 'complete' : 'partial';
};
